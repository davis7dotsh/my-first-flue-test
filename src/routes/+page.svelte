<script lang="ts">
	import {
		createFlueClient,
		type AttachedAgentEvent,
		type FlueClient,
		type FlueEventStream,
		type LlmMessage
	} from '@flue/sdk';
	import { onMount, tick } from 'svelte';

	type ChatMessage = {
		id: string;
		role: 'assistant' | 'user';
		text: string;
	};

	type ToolRun = {
		id: string;
		name: string;
		status: 'running' | 'complete' | 'error';
		input: string;
		result?: string;
	};

	type TraceItem = {
		id: string;
		time: string;
		type: string;
		detail: string;
		tone: 'neutral' | 'active' | 'success' | 'error';
	};

	const storageKey = 'flue-sveltekit-demo-agent-id';
	const welcomeMessage: ChatMessage = {
		id: 'welcome',
		role: 'assistant',
		text: "I'm a small Flue agent running on Cloudflare. Ask me anything, or run the test tool to watch a typed tool call move through the durable event stream."
	};
	const suggestions = [
		{
			label: 'Test the tool',
			prompt: 'Run your test tool with the label "SvelteKit smoke test" and tell me what happened.'
		},
		{
			label: 'Explain Flue',
			prompt: 'Explain what Flue is doing in this demo in plain English.'
		},
		{
			label: 'Ask anything',
			prompt: 'What makes a stateful agent different from a normal chat API?'
		}
	];

	let messages = $state<ChatMessage[]>([welcomeMessage]);
	let toolRuns = $state<ToolRun[]>([]);
	let trace = $state<TraceItem[]>([]);
	let prompt = $state('');
	let agentId = $state('');
	let busy = $state(false);
	let errorMessage = $state('');
	let messageList: HTMLDivElement;
	let client: FlueClient | undefined;

	const canSend = $derived(Boolean(agentId && prompt.trim() && !busy));
	const shortAgentId = $derived(agentId ? agentId.slice(-8) : 'starting');

	onMount(() => {
		client = createFlueClient({ baseUrl: '/api/flue' });
		const storedAgentId = localStorage.getItem(storageKey);
		agentId = storedAgentId ?? createAgentId();
		localStorage.setItem(storageKey, agentId);
		addTrace('ready', 'Browser connected to its durable agent thread.', 'success');
	});

	function createAgentId() {
		return `browser-${crypto.randomUUID()}`;
	}

	function resetConversation() {
		const nextAgentId = createAgentId();
		localStorage.setItem(storageKey, nextAgentId);
		agentId = nextAgentId;
		messages = [{ ...welcomeMessage, id: crypto.randomUUID() }];
		toolRuns = [];
		trace = [];
		errorMessage = '';
		prompt = '';
		addTrace('new_thread', 'Created a fresh Durable Object agent instance.', 'success');
	}

	function addTrace(type: string, detail: string, tone: TraceItem['tone'] = 'neutral') {
		trace = [
			...trace.slice(-29),
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

	function assistantText(message: LlmMessage) {
		if (message.role !== 'assistant') {
			return '';
		}

		return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
	}

	function replaceMessage(id: string, text: string) {
		const message = messages.find((item) => item.id === id);
		if (message) {
			message.text = text;
		}
	}

	function appendMessage(id: string, text: string) {
		const message = messages.find((item) => item.id === id);
		if (message) {
			message.text += text;
		}
	}

	function applyEvent(event: AttachedAgentEvent, assistantMessageId: string) {
		switch (event.type) {
			case 'agent_start':
				addTrace('agent_start', 'The durable agent began processing.', 'active');
				break;
			case 'turn_start':
				addTrace('turn_start', 'A Workers AI model turn started.', 'active');
				break;
			case 'text_delta':
				appendMessage(assistantMessageId, event.text);
				break;
			case 'message_end': {
				const text = assistantText(event.message);
				if (text) {
					replaceMessage(assistantMessageId, text);
				}
				break;
			}
			case 'tool_start':
				toolRuns = [
					...toolRuns,
					{
						id: event.toolCallId,
						name: event.toolName,
						status: 'running',
						input: stringify(event.args ?? {})
					}
				];
				addTrace('tool_start', `${event.toolName} received validated arguments.`, 'active');
				break;
			case 'tool': {
				const tool = toolRuns.find((item) => item.id === event.toolCallId);
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
				addTrace(
					'turn',
					event.isError
						? 'The model turn ended with an error.'
						: `The model turn completed with ${event.stopReason ?? 'a terminal response'}.`,
					event.isError ? 'error' : 'success'
				);
				break;
			case 'submission_settled':
				addTrace(
					'submission_settled',
					event.outcome === 'completed'
						? 'Flue durably settled the submission.'
						: (event.error ?? 'Flue settled the submission as failed.'),
					event.outcome === 'completed' ? 'success' : 'error'
				);
				break;
			case 'idle':
				addTrace('idle', 'The agent stream is idle and ready for another prompt.', 'success');
				break;
		}
	}

	async function scrollToLatest() {
		await tick();
		messageList?.scrollTo({
			top: messageList.scrollHeight,
			behavior: 'smooth'
		});
	}

	async function sendPrompt(override?: string) {
		const question = (override ?? prompt).trim();
		const flueClient = client;
		if (!question || !agentId || busy || !flueClient) {
			return;
		}

		busy = true;
		errorMessage = '';
		prompt = '';
		toolRuns = [];

		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			text: question
		};
		const assistantMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'assistant',
			text: ''
		};
		messages = [...messages, userMessage, assistantMessage];
		addTrace('send', 'Submitting the prompt to the agent Durable Object.', 'active');
		await scrollToLatest();

		let stream: FlueEventStream<AttachedAgentEvent> | undefined;

		try {
			const receipt = await flueClient.agents.send('assistant', agentId, { message: question });
			addTrace(
				'admitted',
				`Submission ${receipt.submissionId.slice(-8)} was durably admitted.`,
				'success'
			);

			stream = flueClient.agents.stream('assistant', agentId, {
				offset: receipt.offset,
				live: true
			});

			let loggedTextStream = false;

			for await (const event of stream) {
				if (event.submissionId && event.submissionId !== receipt.submissionId) {
					continue;
				}

				if (event.type === 'text_delta' && !loggedTextStream) {
					addTrace('text_delta', 'Assistant text is streaming over Durable Streams.', 'active');
					loggedTextStream = true;
				}

				applyEvent(event, assistantMessage.id);
				await scrollToLatest();

				if (event.type === 'idle') {
					break;
				}

				if (event.type === 'submission_settled' && event.outcome === 'failed') {
					throw new Error(event.error ?? 'The durable submission failed.');
				}
			}

			const finalAssistantMessage = messages.find((message) => message.id === assistantMessage.id);
			if (!finalAssistantMessage?.text) {
				replaceMessage(
					assistantMessage.id,
					'The run finished without an assistant text response. Check the event trace for details.'
				);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : 'The agent request failed.';
			errorMessage = detail;
			addTrace('error', detail, 'error');
			replaceMessage(assistantMessage.id, `I couldn't finish that request: ${detail}`);
		} finally {
			stream?.cancel();
			busy = false;
			await scrollToLatest();
		}
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
</script>

<svelte:head>
	<title>Flue + SvelteKit Agent</title>
	<meta
		name="description"
		content="A minimal durable Flue agent with a SvelteKit interface on Cloudflare Workers."
	/>
</svelte:head>

<div class="app-shell">
	<header class="topbar">
		<div class="brand">
			<span class="brand-mark" aria-hidden="true">F</span>
			<div>
				<p class="eyebrow">SvelteKit + Cloudflare</p>
				<h1>Flue field test</h1>
			</div>
		</div>

		<div class="topbar-actions">
			<div class="session-chip" title={agentId}>
				<span class="status-dot"></span>
				<span>thread {shortAgentId}</span>
			</div>
			<button class="secondary-button" type="button" onclick={resetConversation} disabled={busy}>
				New thread
			</button>
		</div>
	</header>

	<main class="workspace">
		<section class="chat-panel" aria-label="Agent conversation">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">Durable conversation</p>
					<h2>Ask the agent</h2>
				</div>
				<div class:working={busy} class="run-status">
					<span></span>
					{busy ? 'Running' : 'Ready'}
				</div>
			</div>

			<div class="message-list" bind:this={messageList} aria-live="polite">
				{#each messages as message (message.id)}
					<article class:user={message.role === 'user'} class="message">
						<div class="message-meta">
							<span>{message.role === 'assistant' ? 'Agent' : 'You'}</span>
							<span>{message.role === 'assistant' ? 'Flue' : 'Browser'}</span>
						</div>
						{#if message.text}
							<p>{message.text}</p>
						{:else}
							<div class="typing" aria-label="Agent is responding">
								<span></span><span></span><span></span>
							</div>
						{/if}
					</article>
				{/each}

				{#each toolRuns as tool (tool.id)}
					<article class:error={tool.status === 'error'} class="tool-card">
						<div class="tool-heading">
							<div>
								<p class="eyebrow">Typed tool call</p>
								<h3>{tool.name}</h3>
							</div>
							<span class:complete={tool.status === 'complete'} class="tool-status">
								{tool.status}
							</span>
						</div>
						<div class="tool-grid">
							<div>
								<span>Input</span>
								<pre>{tool.input}</pre>
							</div>
							{#if tool.result}
								<div>
									<span>Result</span>
									<pre>{tool.result}</pre>
								</div>
							{/if}
						</div>
					</article>
				{/each}
			</div>

			<div class="composer-wrap">
				<div class="suggestions" aria-label="Suggested prompts">
					{#each suggestions as suggestion (suggestion.label)}
						<button
							type="button"
							onclick={() => void sendPrompt(suggestion.prompt)}
							disabled={busy || !agentId}
						>
							{suggestion.label}
						</button>
					{/each}
				</div>

				<form class="composer" onsubmit={handleSubmit}>
					<label for="prompt">Message the agent</label>
					<textarea
						id="prompt"
						bind:value={prompt}
						onkeydown={handleKeydown}
						placeholder="Ask a question, or tell it to run the test tool..."
						rows="3"
						disabled={busy || !agentId}></textarea>
					<div class="composer-footer">
						<span>Enter to send · Shift+Enter for a new line</span>
						<button type="submit" disabled={!canSend}>
							{busy ? 'Working…' : 'Send'}
						</button>
					</div>
				</form>

				{#if errorMessage}
					<p class="error-banner">{errorMessage}</p>
				{/if}
			</div>
		</section>

		<aside class="side-column">
			<section class="trace-panel">
				<div class="panel-heading compact">
					<div>
						<p class="eyebrow">Durable Streams</p>
						<h2>Live event trace</h2>
					</div>
					<span class:working={busy} class="trace-indicator"></span>
				</div>

				<div class="trace-list" aria-live="polite">
					{#if trace.length === 0}
						<p class="empty-state">Events will appear here when the browser connects.</p>
					{:else}
						{#each [...trace].reverse() as item (item.id)}
							<div
								class:active={item.tone === 'active'}
								class:error={item.tone === 'error'}
								class="trace-item"
							>
								<div class="trace-line">
									<code>{item.type}</code>
									<time>{item.time}</time>
								</div>
								<p>{item.detail}</p>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<section class="architecture-card">
				<p class="eyebrow">What is connected</p>
				<h2>Two Workers, one chat</h2>
				<ol>
					<li><span>1</span>SvelteKit owns the interface and same-origin API proxy.</li>
					<li><span>2</span>A service binding forwards requests to the Flue Worker.</li>
					<li><span>3</span>Flue stores the agent thread in Durable Object SQLite.</li>
					<li><span>4</span>Workers AI answers and can call the typed test tool.</li>
				</ol>
				<p class="architecture-note">
					No Git checkout, container, or external sandbox is attached. The browser keeps only the
					durable agent ID.
				</p>
			</section>
		</aside>
	</main>
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		background: #ece9e0;
		color: #20221e;
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
		background:
			linear-gradient(rgba(32, 34, 30, 0.04) 1px, transparent 1px),
			linear-gradient(90deg, rgba(32, 34, 30, 0.04) 1px, transparent 1px), #ece9e0;
		background-size: 32px 32px;
	}

	:global(button),
	:global(textarea) {
		font: inherit;
	}

	button {
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.app-shell {
		width: min(1500px, 100%);
		min-height: 100vh;
		margin: 0 auto;
		padding: 24px;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 18px;
		padding: 0 2px;
	}

	.brand,
	.topbar-actions,
	.panel-heading,
	.tool-heading,
	.composer-footer,
	.trace-line {
		display: flex;
		align-items: center;
	}

	.brand {
		gap: 12px;
	}

	.brand-mark {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border: 1px solid #20221e;
		border-radius: 12px;
		background: #d8ff73;
		box-shadow: 3px 3px 0 #20221e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 20px;
		font-weight: 800;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1 {
		font-size: clamp(1.25rem, 2vw, 1.55rem);
		letter-spacing: -0.04em;
	}

	h2 {
		font-size: 1rem;
		letter-spacing: -0.02em;
	}

	h3 {
		font-size: 0.9rem;
	}

	.eyebrow {
		margin-bottom: 3px;
		color: #666a61;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.topbar-actions {
		gap: 10px;
	}

	.session-chip,
	.run-status,
	.tool-status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 1px solid #c7c7bd;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.65);
		color: #555950;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.session-chip {
		padding: 9px 12px;
	}

	.status-dot,
	.run-status span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #66a329;
		box-shadow: 0 0 0 3px rgba(102, 163, 41, 0.15);
	}

	.secondary-button {
		border: 1px solid #20221e;
		border-radius: 9px;
		background: #fff;
		padding: 9px 13px;
		color: #20221e;
		font-size: 0.8rem;
		font-weight: 750;
		box-shadow: 2px 2px 0 #20221e;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 18px;
		align-items: start;
	}

	.chat-panel,
	.trace-panel,
	.architecture-card {
		overflow: hidden;
		border: 1px solid #bfc0b5;
		background: rgba(250, 249, 244, 0.96);
		box-shadow: 0 14px 42px rgba(42, 43, 38, 0.08);
	}

	.chat-panel {
		display: grid;
		min-height: calc(100vh - 108px);
		grid-template-rows: auto minmax(330px, 1fr) auto;
		border-radius: 18px;
	}

	.panel-heading {
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px;
		border-bottom: 1px solid #d9d9d0;
	}

	.panel-heading.compact {
		padding: 16px;
	}

	.run-status {
		padding: 7px 10px;
	}

	.run-status.working span,
	.trace-indicator.working {
		background: #ff8d4a;
		animation: pulse 1.15s ease-in-out infinite;
		box-shadow: 0 0 0 3px rgba(255, 141, 74, 0.18);
	}

	.message-list {
		overflow-y: auto;
		padding: 24px clamp(16px, 4vw, 52px);
		scrollbar-color: #c6c5bb transparent;
	}

	.message {
		width: min(720px, 91%);
		margin-bottom: 18px;
	}

	.message.user {
		margin-left: auto;
	}

	.message-meta {
		display: flex;
		justify-content: space-between;
		margin: 0 8px 6px;
		color: #75786f;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.message > p,
	.typing {
		border: 1px solid #d3d3ca;
		border-radius: 4px 16px 16px;
		background: #fff;
		padding: 15px 17px;
		color: #292b27;
		font-size: 0.95rem;
		line-height: 1.65;
		white-space: pre-wrap;
		box-shadow: 0 5px 18px rgba(47, 48, 42, 0.05);
	}

	.message.user > p {
		border-color: #20221e;
		border-radius: 16px 4px 16px 16px;
		background: #2c3029;
		color: #f9f8f2;
	}

	.typing {
		display: flex;
		width: 74px;
		gap: 5px;
	}

	.typing span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #868a80;
		animation: bounce 1.1s ease-in-out infinite;
	}

	.typing span:nth-child(2) {
		animation-delay: 0.12s;
	}

	.typing span:nth-child(3) {
		animation-delay: 0.24s;
	}

	.tool-card {
		width: min(760px, 95%);
		margin: 0 auto 18px;
		border: 1px solid #899565;
		border-radius: 13px;
		background: #f4f9e7;
		box-shadow: 3px 3px 0 rgba(75, 83, 53, 0.18);
	}

	.tool-card.error {
		border-color: #ba6255;
		background: #fff0ec;
	}

	.tool-heading {
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid rgba(96, 106, 68, 0.25);
	}

	.tool-status {
		padding: 5px 8px;
	}

	.tool-status.complete {
		border-color: #799744;
		background: #d8ff73;
		color: #31401b;
	}

	.tool-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		background: rgba(96, 106, 68, 0.2);
	}

	.tool-grid > div {
		min-width: 0;
		background: #f9fbea;
		padding: 12px 14px;
	}

	.tool-grid span {
		display: block;
		margin-bottom: 7px;
		color: #697152;
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	pre {
		overflow-x: auto;
		margin: 0;
		color: #3d4430;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.composer-wrap {
		padding: 14px 18px 18px;
		border-top: 1px solid #d9d9d0;
		background: #f3f1e9;
	}

	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-bottom: 10px;
	}

	.suggestions button {
		border: 1px solid #cacbc1;
		border-radius: 999px;
		background: #fff;
		padding: 7px 10px;
		color: #555950;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.suggestions button:hover:not(:disabled) {
		border-color: #20221e;
		color: #20221e;
	}

	.composer {
		border: 1px solid #a9aaa1;
		border-radius: 13px;
		background: #fff;
		padding: 12px;
		box-shadow: 0 4px 14px rgba(42, 43, 38, 0.05);
	}

	.composer:focus-within {
		border-color: #20221e;
		box-shadow: 0 0 0 3px rgba(216, 255, 115, 0.7);
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
		resize: none;
		border: 0;
		outline: 0;
		background: transparent;
		color: #20221e;
		line-height: 1.45;
	}

	.composer textarea::placeholder {
		color: #9a9c94;
	}

	.composer-footer {
		justify-content: space-between;
		gap: 12px;
		margin-top: 6px;
	}

	.composer-footer > span {
		color: #898c83;
		font-size: 0.67rem;
	}

	.composer-footer button {
		border: 1px solid #20221e;
		border-radius: 8px;
		background: #d8ff73;
		padding: 8px 18px;
		color: #20221e;
		font-size: 0.78rem;
		font-weight: 800;
		box-shadow: 2px 2px 0 #20221e;
	}

	.error-banner {
		margin-top: 10px;
		border: 1px solid #c47466;
		border-radius: 9px;
		background: #fff0ec;
		padding: 9px 11px;
		color: #8d3025;
		font-size: 0.78rem;
	}

	.side-column {
		display: grid;
		gap: 18px;
	}

	.trace-panel,
	.architecture-card {
		border-radius: 16px;
	}

	.trace-indicator {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #66a329;
		box-shadow: 0 0 0 3px rgba(102, 163, 41, 0.15);
	}

	.trace-list {
		overflow-y: auto;
		max-height: 460px;
		padding: 8px;
	}

	.empty-state {
		padding: 30px 18px;
		color: #7b7e75;
		font-size: 0.8rem;
		line-height: 1.5;
		text-align: center;
	}

	.trace-item {
		border-left: 2px solid #b2b4aa;
		padding: 9px 10px 10px 12px;
	}

	.trace-item.active {
		border-left-color: #ff8d4a;
		background: #fff8ef;
	}

	.trace-item.error {
		border-left-color: #ba6255;
		background: #fff0ec;
	}

	.trace-line {
		justify-content: space-between;
		gap: 8px;
	}

	.trace-line code {
		color: #42473d;
		font-size: 0.7rem;
		font-weight: 800;
	}

	.trace-line time {
		color: #94968e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.61rem;
	}

	.trace-item p {
		margin-top: 4px;
		color: #676b62;
		font-size: 0.72rem;
		line-height: 1.45;
	}

	.architecture-card {
		padding: 18px;
	}

	.architecture-card ol {
		display: grid;
		gap: 10px;
		margin: 16px 0;
		padding: 0;
		list-style: none;
	}

	.architecture-card li {
		display: grid;
		grid-template-columns: 24px 1fr;
		gap: 9px;
		align-items: start;
		color: #555950;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.architecture-card li span {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		border: 1px solid #9da08f;
		border-radius: 7px;
		background: #f2f3e9;
		color: #555950;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.65rem;
		font-weight: 800;
	}

	.architecture-note {
		border-top: 1px solid #deded5;
		padding-top: 13px;
		color: #777a71;
		font-size: 0.72rem;
		line-height: 1.5;
	}

	@keyframes pulse {
		50% {
			opacity: 0.4;
			transform: scale(0.75);
		}
	}

	@keyframes bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
		}
		30% {
			transform: translateY(-4px);
		}
	}

	@media (max-width: 980px) {
		.workspace {
			grid-template-columns: 1fr;
		}

		.chat-panel {
			min-height: 760px;
		}

		.side-column {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 680px) {
		.app-shell {
			padding: 14px;
		}

		.topbar {
			align-items: flex-start;
			flex-direction: column;
		}

		.topbar-actions {
			width: 100%;
			justify-content: space-between;
		}

		.workspace,
		.side-column {
			grid-template-columns: 1fr;
		}

		.chat-panel {
			min-height: calc(100vh - 150px);
		}

		.message-list {
			padding: 20px 12px;
		}

		.message,
		.tool-card {
			width: 100%;
		}

		.tool-grid {
			grid-template-columns: 1fr;
		}

		.composer-footer > span {
			display: none;
		}

		.composer-footer {
			justify-content: flex-end;
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
