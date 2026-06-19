<script lang="ts">
	import {
		createFlueClient,
		DurableStreamError,
		FetchError,
		type AttachedAgentEvent,
		type FlueClient,
		type FlueEventStream,
		type LlmMessage
	} from '@flue/sdk';
	import SvelteMarkdown, {
		buildUnsupportedHTML,
		defaultRenderers
	} from '@humanspeak/svelte-markdown';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		appendThreadHistoryEvent,
		eventKey,
		forgetPendingThreadPrompt,
		loadPendingThreadPrompts,
		loadThreadHistory,
		rememberPendingThreadPrompt
	} from '$lib/chat-history';
	import type { ThreadSummary } from '$lib/threads';
	import { onMount, tick } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';

	type ChatMessage = {
		id: string;
		kind: 'message';
		role: 'assistant' | 'user';
		text: string;
		reasoning?: string;
	};

	type ToolRun = {
		id: string;
		kind: 'tool';
		name: string;
		status: 'running' | 'complete' | 'error';
		input: string;
		result?: string;
	};

	type ConversationItem = ChatMessage | ToolRun;

	type TraceItem = {
		id: string;
		time: string;
		type: string;
		detail: string;
		tone: 'neutral' | 'active' | 'success' | 'error';
	};

	type RunState = 'error' | 'idle' | 'loading' | 'working';

	let { thread }: { thread?: ThreadSummary } = $props();

	function hasThread() {
		return Boolean(thread);
	}

	const welcomeMessage: ChatMessage = {
		id: 'welcome',
		kind: 'message',
		role: 'assistant',
		text: 'Hi. Give me a research question or a public repository to investigate.'
	};

	let conversation = $state<ConversationItem[]>([welcomeMessage]);
	let trace = $state<TraceItem[]>([]);
	let prompt = $state('');
	let busy = $state(false);
	let hydrating = $state(hasThread());
	let errorMessage = $state('');
	let failedPrompt = $state('');
	let lastPrompt = $state('');
	let debugOpen = $state(false);
	let messageList: HTMLDivElement | undefined;
	let promptInput: HTMLTextAreaElement | undefined;
	let client: FlueClient | undefined;
	let stream: FlueEventStream<AttachedAgentEvent> | undefined;
	let following = false;
	let startFollowing: ((offset: string) => void) | undefined;
	let processedEvents = new SvelteSet<string>();
	let assistantMessages = new SvelteMap<string, string>();
	let unassignedOptimisticUserIds = new SvelteSet<string>();
	let submissionUserIds = new SvelteMap<string, string>();
	let submissionPrompts = new SvelteMap<string, string>();

	const canSend = $derived(Boolean(prompt.trim() && !busy && !hydrating));
	const canRetry = $derived(Boolean(failedPrompt && !busy && !hydrating));
	const runState = $derived<RunState>(
		errorMessage ? 'error' : hydrating ? 'loading' : busy ? 'working' : 'idle'
	);
	const runStateLabel = $derived(
		runState === 'error'
			? 'Error'
			: runState === 'loading'
				? 'Loading'
				: runState === 'working'
					? 'Working'
					: 'Idle'
	);
	const markdownRenderers = {
		...defaultRenderers,
		html: buildUnsupportedHTML()
	};

	onMount(() => {
		const flueClient = createFlueClient({ baseUrl: '/api/flue' });
		let cancelled = false;

		stream?.cancel();
		stream = undefined;
		client = flueClient;
		following = false;
		processedEvents = new SvelteSet<string>();
		assistantMessages = new SvelteMap<string, string>();
		conversation = [welcomeMessage];
		trace = [];
		busy = false;
		hydrating = Boolean(thread);
		errorMessage = '';
		failedPrompt = '';
		lastPrompt = '';
		unassignedOptimisticUserIds = new SvelteSet<string>();
		submissionUserIds = new SvelteMap<string, string>();
		submissionPrompts = new SvelteMap<string, string>();

		const activeThread = thread;
		if (!activeThread) {
			hydrating = false;

			return () => {
				cancelled = true;
				client = undefined;
			};
		}

		const pendingPrompts = loadPendingThreadPrompts(activeThread.id);
		conversation = [
			welcomeMessage,
			...pendingPrompts.map(
				(prompt) =>
					({
						id: prompt.id,
						kind: 'message',
						role: 'user',
						text: prompt.text
					}) satisfies ChatMessage
			)
		];
		unassignedOptimisticUserIds = new SvelteSet(pendingPrompts.map((prompt) => prompt.id));
		lastPrompt = pendingPrompts.at(-1)?.text ?? '';

		const follow = async (offset: string) => {
			if (following || cancelled) {
				return;
			}

			following = true;
			stream = flueClient.agents.stream(activeThread.agentName, activeThread.id, {
				offset,
				live: true
			});

			try {
				for await (const event of stream) {
					if (cancelled) {
						break;
					}

					applyEvent(event);
					appendThreadHistoryEvent(activeThread.id, event, stream.offset);
					await scrollToLatest();
				}
			} catch (error) {
				if (!cancelled) {
					if (isMissingStream(error)) {
						addTrace('ready', 'New durable thread is ready.', 'success');
					} else {
						const detail = error instanceof Error ? error.message : 'The agent stream failed.';
						errorMessage = detail;
						failedPrompt = mostRecentPrompt();
						addTrace('error', detail, 'error');
					}
				}
			} finally {
				if (!cancelled) {
					following = false;
					busy = false;
					hydrating = false;
				}
			}
		};

		startFollowing = (offset) => void follow(offset);

		const hydrate = async () => {
			try {
				const history = await loadThreadHistory(activeThread);
				if (cancelled) {
					return;
				}

				for (const event of history.events) {
					applyEvent(event);
				}
				hydrating = false;
				await scrollToLatest('auto');
				startFollowing?.(history.offset);
			} catch (error) {
				if (!cancelled) {
					const detail = error instanceof Error ? error.message : 'The thread could not be loaded.';
					errorMessage = detail;
					addTrace('error', detail, 'error');
					hydrating = false;
				}
			}
		};

		void hydrate();

		return () => {
			cancelled = true;
			stream?.cancel();
			stream = undefined;
			startFollowing = undefined;
			if (client === flueClient) {
				client = undefined;
			}
		};
	});

	function isMissingStream(error: unknown) {
		return (
			(error instanceof FetchError || error instanceof DurableStreamError) && error.status === 404
		);
	}

	function addTrace(type: string, detail: string, tone: TraceItem['tone'] = 'neutral') {
		trace = [
			...trace.slice(-49),
			{
				id: crypto.randomUUID(),
				time: new Intl.DateTimeFormat(undefined, {
					hour: 'numeric',
					minute: '2-digit',
					second: '2-digit'
				}).format(new Date()),
				type,
				detail,
				tone
			}
		];
	}

	function mostRecentPrompt() {
		const submitted = [...submissionPrompts.values()].at(-1);
		if (submitted) {
			return submitted;
		}
		return lastPrompt;
	}

	function eventErrorDetail(error: unknown, fallback: string) {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === 'string' && error.trim()) {
			return error;
		}
		if (error && typeof error === 'object' && 'message' in error) {
			const message = error.message;
			if (typeof message === 'string' && message.trim()) {
				return message;
			}
		}

		return fallback;
	}

	function captureMessageList(element: HTMLDivElement) {
		messageList = element;

		return () => {
			if (messageList === element) {
				messageList = undefined;
			}
		};
	}

	function capturePromptInput(element: HTMLTextAreaElement) {
		promptInput = element;

		return () => {
			if (promptInput === element) {
				promptInput = undefined;
			}
		};
	}

	function stringify(value: unknown) {
		if (typeof value === 'string') {
			try {
				return JSON.stringify(JSON.parse(value), null, 2);
			} catch {
				return value;
			}
		}

		return JSON.stringify(value, null, 2) ?? 'Completed without a result payload.';
	}

	function messageText(message: LlmMessage) {
		if (typeof message.content === 'string') {
			return message.content;
		}

		return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
	}

	function messageReasoning(message: LlmMessage) {
		if (message.role !== 'assistant') {
			return '';
		}

		return message.content
			.filter((block) => block.type === 'thinking')
			.map((block) => block.thinking)
			.filter(Boolean)
			.join('\n\n');
	}

	function reconcileUserMessage(event: AttachedAgentEvent, message: LlmMessage) {
		if (message.role !== 'user') {
			return;
		}

		const text = messageText(message);
		lastPrompt = text;
		const durableId = `user:${event.submissionId ?? 'session'}:${event.turnId ?? event.eventIndex}`;
		if (event.submissionId) {
			submissionPrompts.set(event.submissionId, text);
		}

		const existingIndex = conversation.findIndex(
			(item) => item.kind === 'message' && item.id === durableId
		);
		if (existingIndex >= 0) {
			conversation[existingIndex] = {
				id: durableId,
				kind: 'message',
				role: 'user',
				text
			};
			return;
		}

		let optimisticId = event.submissionId ? submissionUserIds.get(event.submissionId) : undefined;
		if (!optimisticId) {
			optimisticId = [...unassignedOptimisticUserIds].find((id) =>
				conversation.some((item) => item.kind === 'message' && item.id === id && item.text === text)
			);
		}

		const optimisticIndex = optimisticId
			? conversation.findIndex((item) => item.kind === 'message' && item.id === optimisticId)
			: -1;
		if (optimisticIndex >= 0 && optimisticId) {
			conversation[optimisticIndex] = {
				id: durableId,
				kind: 'message',
				role: 'user',
				text
			};
			unassignedOptimisticUserIds.delete(optimisticId);
			if (thread) {
				forgetPendingThreadPrompt(thread.id, optimisticId);
			}
			if (event.submissionId) {
				submissionUserIds.delete(event.submissionId);
			}
			return;
		}

		conversation = [
			...conversation,
			{
				id: durableId,
				kind: 'message',
				role: 'user',
				text
			}
		];
	}

	function reasoningPreview(reasoning: string) {
		return reasoning.split(/\r?\n/, 1)[0]?.trim() || 'Reasoning';
	}

	function assistantKey(event: AttachedAgentEvent) {
		return `${event.submissionId ?? 'session'}:${event.turnId ?? 'turn'}`;
	}

	function ensureAssistantMessage(event: AttachedAgentEvent) {
		const key = assistantKey(event);
		let messageId = assistantMessages.get(key);
		if (!messageId) {
			messageId = `assistant:${key}`;
			assistantMessages.set(key, messageId);
			conversation = [
				...conversation,
				{
					id: messageId,
					kind: 'message',
					role: 'assistant',
					text: ''
				}
			];
		}

		return conversation.find(
			(item): item is ChatMessage => item.kind === 'message' && item.id === messageId
		);
	}

	function setAssistantText(event: AttachedAgentEvent, text: string, append: boolean) {
		if (!text) {
			return;
		}

		const message = ensureAssistantMessage(event);
		if (message) {
			message.text = append ? message.text + text : text;
		}
	}

	function setAssistantReasoning(event: AttachedAgentEvent, reasoning: string, append: boolean) {
		if (!reasoning) {
			return;
		}

		const message = ensureAssistantMessage(event);
		if (message) {
			message.reasoning = append ? (message.reasoning ?? '') + reasoning : reasoning;
		}
	}

	function applyEvent(event: AttachedAgentEvent) {
		const key = eventKey(event);
		if (processedEvents.has(key)) {
			return;
		}
		processedEvents.add(key);

		switch (event.type) {
			case 'agent_start':
				busy = true;
				hydrating = false;
				addTrace('agent_start', 'The agent began processing.', 'active');
				break;
			case 'turn_start':
				addTrace('turn_start', 'A model turn started.', 'active');
				break;
			case 'text_delta':
				setAssistantText(event, event.text, true);
				break;
			case 'thinking_start':
				ensureAssistantMessage(event);
				break;
			case 'thinking_delta':
				setAssistantReasoning(event, event.delta, true);
				break;
			case 'thinking_end':
				setAssistantReasoning(event, event.content, false);
				break;
			case 'message_start':
				reconcileUserMessage(event, event.message);
				break;
			case 'message_end':
				if (event.message.role === 'user') {
					reconcileUserMessage(event, event.message);
				} else if (event.message.role === 'assistant') {
					const reasoning = messageReasoning(event.message);
					if (reasoning) {
						setAssistantReasoning(event, reasoning, false);
					}
					setAssistantText(event, messageText(event.message), false);
				}
				break;
			case 'tool_start':
				conversation = [
					...conversation,
					{
						id: event.toolCallId,
						kind: 'tool',
						name: event.toolName,
						status: 'running',
						input: stringify(event.args ?? {})
					}
				];
				addTrace('tool_start', `${event.toolName} received validated arguments.`, 'active');
				break;
			case 'tool': {
				const tool = conversation.find(
					(item): item is ToolRun => item.kind === 'tool' && item.id === event.toolCallId
				);
				if (tool) {
					tool.status = event.isError ? 'error' : 'complete';
					tool.result = stringify(event.result);
				}
				addTrace(
					'tool',
					`${event.toolName} ${event.isError ? 'failed' : 'completed'} in ${event.durationMs} ms.`,
					event.isError ? 'error' : 'success'
				);
				break;
			}
			case 'turn':
				if (event.isError) {
					errorMessage = eventErrorDetail(event.error, 'The model turn failed.');
					failedPrompt = event.submissionId
						? (submissionPrompts.get(event.submissionId) ?? mostRecentPrompt())
						: mostRecentPrompt();
				}
				addTrace(
					'turn',
					event.isError
						? 'The model turn ended with an error.'
						: `The model turn completed with ${event.stopReason ?? 'a terminal response'}.`,
					event.isError ? 'error' : 'success'
				);
				break;
			case 'submission_settled':
				busy = false;
				hydrating = false;
				if (event.outcome === 'failed') {
					errorMessage = event.error ?? 'The submission failed.';
					failedPrompt = submissionPrompts.get(event.submissionId) ?? mostRecentPrompt();
				}
				addTrace(
					'submission_settled',
					event.outcome === 'completed'
						? 'The submission settled.'
						: (event.error ?? 'The submission failed.'),
					event.outcome === 'completed' ? 'success' : 'error'
				);
				break;
			case 'idle':
				busy = false;
				hydrating = false;
				addTrace('idle', 'The event stream is idle.', 'success');
				break;
		}
	}

	async function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
		await tick();
		messageList?.scrollTo({
			top: messageList.scrollHeight,
			behavior
		});
	}

	async function sendPrompt() {
		const question = prompt.trim();
		const flueClient = client;
		if (!question || busy || hydrating || !flueClient) {
			return;
		}

		const optimisticUserId = `user:local:${crypto.randomUUID()}`;
		conversation = [
			...conversation,
			{
				id: optimisticUserId,
				kind: 'message',
				role: 'user',
				text: question
			}
		];
		unassignedOptimisticUserIds.add(optimisticUserId);
		lastPrompt = question;
		busy = true;
		errorMessage = '';
		failedPrompt = '';
		prompt = '';

		addTrace('send', 'Submitting the prompt.', 'active');
		await scrollToLatest();

		let createdThread: ThreadSummary | undefined;

		try {
			let targetThread = thread;
			if (!targetThread) {
				const response = await fetch('/api/threads', { method: 'POST' });
				if (!response.ok) {
					throw new Error('Could not create a thread.');
				}

				const newThread: ThreadSummary = await response.json();
				targetThread = newThread;
				createdThread = newThread;
			}

			rememberPendingThreadPrompt(targetThread.id, {
				id: optimisticUserId,
				text: question
			});

			const receipt = await flueClient.agents.send(targetThread.agentName, targetThread.id, {
				message: question
			});
			submissionPrompts.set(receipt.submissionId, question);
			if (unassignedOptimisticUserIds.delete(optimisticUserId)) {
				submissionUserIds.set(receipt.submissionId, optimisticUserId);
			}
			addTrace('admitted', `Submission ${receipt.submissionId.slice(-8)} was admitted.`, 'success');

			if (createdThread) {
				await goto(resolve('/chat/[id]', { id: createdThread.id }), { invalidateAll: true });
				return;
			}

			if (!following) {
				startFollowing?.(receipt.offset);
			}
			await invalidateAll();
		} catch (error) {
			if (createdThread) {
				forgetPendingThreadPrompt(createdThread.id, optimisticUserId);
				await fetch(`/api/threads/${encodeURIComponent(createdThread.id)}`, {
					method: 'DELETE'
				}).catch(() => undefined);
				await invalidateAll();
			}

			const detail = error instanceof Error ? error.message : 'The agent request failed.';
			errorMessage = detail;
			failedPrompt = question;
			addTrace('error', detail, 'error');
			busy = false;
			unassignedOptimisticUserIds.delete(optimisticUserId);
			prompt = question;
			await scrollToLatest();
		}
	}

	async function retryFailedPrompt() {
		if (!canRetry) {
			return;
		}

		prompt = failedPrompt;
		failedPrompt = '';
		await tick();
		await sendPrompt();
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void sendPrompt();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && canSend) {
			event.preventDefault();
			void sendPrompt();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		const target = event.target;
		const isEditable =
			target instanceof HTMLElement &&
			(target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'));

		if (
			isEditable ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			!/^[a-zA-Z0-9]$/.test(event.key) ||
			!promptInput ||
			promptInput.disabled
		) {
			return;
		}

		event.preventDefault();
		const selectionStart = promptInput.selectionStart ?? prompt.length;
		const selectionEnd = promptInput.selectionEnd ?? selectionStart;
		prompt = prompt.slice(0, selectionStart) + event.key + prompt.slice(selectionEnd);
		promptInput.focus();

		void tick().then(() => {
			const cursor = selectionStart + event.key.length;
			promptInput?.setSelectionRange(cursor, cursor);
		});
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<main class="chat">
	<div class="conversation" {@attach captureMessageList} aria-live="polite">
		<div class="conversation-inner" aria-busy={hydrating}>
			{#if hydrating}
				<div class="thread-skeleton" aria-label="Loading conversation">
					<span></span>
					<span></span>
					<span></span>
				</div>
			{:else}
				<div
					class="conversation-items"
					in:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}
				>
					{#each conversation as item (item.id)}
						{#if item.kind === 'message'}
							<article class={['message', item.role === 'user' && 'user']}>
								<span>{item.role === 'assistant' ? 'Agent' : 'You'}</span>
								{#if item.role === 'assistant' && item.reasoning}
									<details class="reasoning">
										<summary>
											<strong>Reasoning</strong>
											<span class="reasoning-preview">
												<SvelteMarkdown
													source={reasoningPreview(item.reasoning)}
													renderers={markdownRenderers}
													isInline
												/>
											</span>
										</summary>
										<div class="reasoning-content">
											<SvelteMarkdown source={item.reasoning} renderers={markdownRenderers} />
										</div>
									</details>
								{/if}
								<p>{item.text}</p>
							</article>
						{:else}
							<details class={['tool-call', item.status === 'error' && 'error']}>
								<summary>
									<span class="tool-icon" aria-hidden="true">›_</span>
									<strong>{item.name}</strong>
									<span class={['tool-status', item.status]}>{item.status}</span>
								</summary>
								<div class="tool-body">
									<div>
										<span>Input</span>
										<pre>{item.input}</pre>
									</div>
									{#if item.result}
										<div>
											<span>Result</span>
											<pre>{item.result}</pre>
										</div>
									{/if}
								</div>
							</details>
						{/if}
					{/each}

					{#if busy}
						<p class="working">Agent is working...</p>
					{/if}

					{#if errorMessage}
						<div class="run-error" role="alert">
							<div>
								<strong>The agent could not finish this run.</strong>
								<p>{errorMessage}</p>
							</div>
							{#if failedPrompt}
								<button type="button" disabled={!canRetry} onclick={() => void retryFailedPrompt()}>
									Try again
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</main>

<div class="composer-shell">
	<form class="composer" onsubmit={handleSubmit}>
		<label for="prompt">Message the agent</label>
		<textarea
			id="prompt"
			{@attach capturePromptInput}
			bind:value={prompt}
			onkeydown={handleKeydown}
			placeholder="Message the agent..."
			rows="2"
			disabled={busy || hydrating}></textarea>
		<button type="submit" disabled={!canSend} aria-label="Send message">
			{busy ? '…' : '↑'}
		</button>
	</form>
</div>

<button
	class="debug-button"
	type="button"
	aria-controls="debug-panel"
	aria-expanded={debugOpen}
	onclick={() => (debugOpen = !debugOpen)}
>
	Debug · {runStateLabel}
	<span class={runState} aria-hidden="true"></span>
</button>

{#if debugOpen}
	<section id="debug-panel" class="debug-panel" aria-label="Live event trace">
		<header>
			<div>
				<strong>Live event trace</strong>
				<span>{trace.length} events</span>
			</div>
			<button type="button" aria-label="Close debug panel" onclick={() => (debugOpen = false)}>
				×
			</button>
		</header>
		<div class="trace-list" aria-live="polite">
			{#each [...trace].reverse() as item (item.id)}
				<article class={['trace-item', item.tone]}>
					<div>
						<code>{item.type}</code>
						<time>{item.time}</time>
					</div>
					<p>{item.detail}</p>
				</article>
			{:else}
				<p class="empty-trace">Waiting for events.</p>
			{/each}
		</div>
	</section>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		background: var(--background);
		color: var(--text);
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	:global(body) {
		margin: 0;
		min-width: 320px;
		min-height: 100vh;
		background: var(--background);
	}

	:global(button),
	:global(textarea) {
		font: inherit;
	}

	button {
		cursor: pointer;
	}

	button:disabled {
		cursor: default;
		opacity: 0.35;
	}

	p {
		margin: 0;
	}

	.chat {
		height: 100%;
	}

	.conversation {
		height: 100%;
		overflow-y: auto;
		padding: 48px 20px 180px;
		scrollbar-color: var(--border-strong) transparent;
	}

	.conversation-inner {
		width: min(1040px, 100%);
		margin: 0 auto;
	}

	.thread-skeleton {
		display: grid;
		gap: 16px;
		opacity: 0;
		animation: reveal-loading 0s 120ms forwards;
	}

	.thread-skeleton span {
		display: block;
		height: 16px;
		border-radius: 999px;
		background: var(--border);
	}

	.thread-skeleton span:nth-child(1) {
		width: 78%;
	}

	.thread-skeleton span:nth-child(2) {
		width: 58%;
	}

	.thread-skeleton span:nth-child(3) {
		width: 70%;
		margin-top: 18px;
		margin-left: auto;
	}

	.message {
		margin-bottom: 28px;
	}

	.message > span {
		display: block;
		margin-bottom: 8px;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-weight: 650;
	}

	.message p {
		color: var(--text-soft);
		font-size: 1rem;
		line-height: 1.7;
		white-space: pre-wrap;
	}

	.reasoning {
		margin-bottom: 14px;
		color: var(--text-muted);
	}

	.reasoning summary {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 9px;
		align-items: center;
		min-height: 44px;
		padding: 0;
		cursor: pointer;
		list-style: none;
		font-size: 0.72rem;
	}

	.reasoning summary::-webkit-details-marker {
		display: none;
	}

	.reasoning summary::after {
		content: '+';
		color: var(--text-faint);
		font-size: 0.9rem;
	}

	.reasoning[open] summary::after {
		content: '−';
	}

	.reasoning-preview {
		overflow: hidden;
		color: var(--text-faint);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reasoning-content {
		max-height: 320px;
		overflow: auto;
		padding-top: 12px;
		color: var(--text-muted);
		font-size: 0.82rem;
		line-height: 1.65;
	}

	.reasoning-content :global(:first-child) {
		margin-top: 0;
	}

	.reasoning-content :global(:last-child) {
		margin-bottom: 0;
	}

	.reasoning-content :global(p),
	.reasoning-content :global(ul),
	.reasoning-content :global(ol),
	.reasoning-content :global(pre),
	.reasoning-content :global(blockquote) {
		margin: 0 0 0.85em;
	}

	.reasoning-content :global(ul),
	.reasoning-content :global(ol) {
		padding-left: 1.4em;
	}

	.reasoning-content :global(h1),
	.reasoning-content :global(h2),
	.reasoning-content :global(h3),
	.reasoning-content :global(h4) {
		margin: 1em 0 0.45em;
		color: var(--text-soft);
		font-size: 1em;
		line-height: 1.35;
	}

	.reasoning-content :global(code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.92em;
	}

	.reasoning-content :global(a) {
		color: var(--text-soft);
		text-underline-offset: 2px;
	}

	.reasoning-content :global(blockquote) {
		border-left: 2px solid var(--border-strong);
		padding-left: 10px;
	}

	.message.user {
		display: flex;
		align-items: flex-end;
		flex-direction: column;
	}

	.message.user p {
		max-width: 82%;
		border-radius: 18px 18px 4px 18px;
		background: var(--contrast);
		padding: 11px 15px;
		color: var(--contrast-text);
		line-height: 1.5;
	}

	.tool-call {
		margin: -10px 0 28px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text-soft);
	}

	.tool-call.error {
		border-color: var(--danger-border);
	}

	.tool-call summary {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 9px;
		align-items: center;
		min-height: 44px;
		padding: 10px 12px;
		cursor: pointer;
		list-style: none;
		font-size: 0.78rem;
	}

	.tool-call summary::-webkit-details-marker {
		display: none;
	}

	.tool-call summary::after {
		content: '+';
		grid-column: 4;
		color: var(--text-faint);
		font-size: 1rem;
	}

	.tool-call[open] summary::after {
		content: '−';
	}

	.tool-icon {
		color: var(--text-muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.tool-status {
		border-radius: 999px;
		background: var(--sidebar);
		padding: 3px 7px;
		color: var(--text-muted);
		font-size: 0.65rem;
		font-weight: 700;
	}

	.tool-status.complete {
		background: var(--success-surface);
		color: var(--success-text);
	}

	.tool-status.error {
		background: var(--danger-surface);
		color: var(--danger-text);
	}

	.tool-body {
		display: grid;
		gap: 1px;
		border-top: 1px solid var(--border);
		background: var(--border);
	}

	.tool-body > div {
		min-width: 0;
		background: var(--code-surface);
		padding: 12px;
	}

	.tool-body span {
		display: block;
		margin-bottom: 6px;
		color: var(--text-faint);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	pre {
		overflow-x: auto;
		margin: 0;
		color: var(--text-muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.72rem;
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.working {
		color: var(--text-faint);
		font-size: 0.78rem;
	}

	.run-error {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
		margin-top: 18px;
		border: 1px solid var(--danger-border);
		border-radius: 12px;
		background: var(--danger-surface);
		padding: 12px 14px;
		color: var(--danger-text);
	}

	.run-error strong {
		font-size: 0.82rem;
	}

	.run-error > div {
		min-width: 0;
	}

	.run-error p {
		margin-top: 4px;
		font-size: 0.75rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.run-error button {
		min-width: 88px;
		min-height: 44px;
		border: 1px solid var(--danger-border);
		border-radius: 9px;
		background: var(--surface);
		color: var(--danger-text);
		font-size: 0.75rem;
		font-weight: 700;
	}

	.composer-shell {
		position: absolute;
		z-index: 10;
		right: 0;
		bottom: 0;
		left: 0;
		padding: 20px max(20px, env(safe-area-inset-right))
			max(20px, calc(env(safe-area-inset-bottom) + 12px)) max(20px, env(safe-area-inset-left));
		background: linear-gradient(transparent, var(--background) 35%);
		pointer-events: none;
	}

	.composer {
		display: grid;
		width: min(1040px, 100%);
		margin: 0 auto;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: end;
		border: 1px solid var(--border-strong);
		border-radius: 18px;
		background: var(--surface);
		padding: 11px 11px 11px 16px;
		box-shadow: 0 12px 36px var(--shadow);
		pointer-events: auto;
	}

	.composer:focus-within {
		border-color: var(--text-faint);
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--text-faint) 12%, transparent),
			0 12px 36px var(--shadow);
	}

	.composer label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.composer textarea {
		width: 100%;
		max-height: 160px;
		resize: none;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
		line-height: 1.45;
	}

	.composer textarea::placeholder {
		color: var(--text-faint);
	}

	.composer button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 0;
		border-radius: 11px;
		background: var(--contrast);
		color: var(--contrast-text);
		font-size: 1.15rem;
		font-weight: 700;
	}

	.debug-button {
		position: absolute;
		z-index: 30;
		right: 18px;
		bottom: 122px;
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 7px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface-raised);
		padding: 8px 11px;
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 700;
		box-shadow: 0 6px 20px var(--shadow);
		backdrop-filter: blur(10px);
	}

	.debug-button span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
	}

	.debug-button span.working,
	.debug-button span.loading {
		background: #f59e0b;
		animation: pulse 1s ease-in-out infinite;
	}

	.debug-button span.error {
		background: #ef4444;
	}

	.debug-panel {
		position: absolute;
		z-index: 20;
		right: 18px;
		bottom: 164px;
		display: grid;
		width: min(380px, calc(100vw - 36px));
		max-height: min(520px, calc(100vh - 210px));
		grid-template-rows: auto minmax(0, 1fr);
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: 0 18px 50px var(--shadow-strong);
		backdrop-filter: blur(14px);
	}

	.debug-panel header,
	.debug-panel header > div,
	.trace-item > div {
		display: flex;
		align-items: center;
	}

	.debug-panel header {
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid var(--border);
		padding: 12px 14px;
	}

	.debug-panel header > div {
		gap: 8px;
	}

	.debug-panel header strong {
		font-size: 0.78rem;
	}

	.debug-panel header span {
		color: var(--text-faint);
		font-size: 0.66rem;
	}

	.debug-panel header button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 0;
		background: transparent;
		padding: 2px 4px;
		color: var(--text-muted);
		font-size: 1.1rem;
	}

	.trace-list {
		overflow-y: auto;
		padding: 7px;
	}

	.trace-item {
		border-left: 2px solid var(--border-strong);
		padding: 8px 9px 9px 10px;
	}

	.trace-item.active {
		border-left-color: #f59e0b;
	}

	.trace-item.success {
		border-left-color: #22c55e;
	}

	.trace-item.error {
		border-left-color: #ef4444;
		background: var(--danger-surface);
	}

	.trace-item > div {
		justify-content: space-between;
		gap: 12px;
	}

	.trace-item code {
		color: var(--text-soft);
		font-size: 0.68rem;
		font-weight: 700;
	}

	.trace-item time {
		color: var(--text-faint);
		font-size: 0.6rem;
	}

	.trace-item p,
	.empty-trace {
		margin-top: 4px;
		color: var(--text-muted);
		font-size: 0.68rem;
		line-height: 1.45;
	}

	.empty-trace {
		padding: 22px;
		text-align: center;
	}

	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}

	@keyframes reveal-loading {
		to {
			opacity: 0.65;
		}
	}

	@media (max-width: 760px) {
		.conversation {
			padding: 30px 16px 164px;
		}

		.message.user p {
			max-width: 90%;
		}

		.run-error {
			align-items: stretch;
			flex-direction: column;
		}

		.run-error button {
			align-self: flex-start;
		}

		.debug-button {
			right: 14px;
			bottom: 112px;
		}

		.debug-panel {
			right: 14px;
			bottom: 152px;
			width: calc(100vw - 28px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			scroll-behavior: auto !important;
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
		}
	}
</style>
