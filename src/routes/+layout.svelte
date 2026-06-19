<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { deleteThreadHistory, loadThreadHistory } from '$lib/chat-history';
	import type { ThreadSummary } from '$lib/threads';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	let deletingThreadId = $state<string | null>(null);
	let threadError = $state('');
	let darkMode = $state(false);

	const activeThreadId = $derived(page.params.id);

	onMount(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const storedTheme = localStorage.getItem('flue-theme');
		const followsSystem = storedTheme !== 'light' && storedTheme !== 'dark';

		darkMode = followsSystem ? media.matches : storedTheme === 'dark';

		const syncSystemTheme = (event: MediaQueryListEvent) => {
			if (!document.documentElement.dataset.theme) {
				darkMode = event.matches;
			}
		};

		media.addEventListener('change', syncSystemTheme);

		return () => media.removeEventListener('change', syncSystemTheme);
	});

	function toggleTheme() {
		darkMode = !darkMode;
		const theme = darkMode ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('flue-theme', theme);
	}

	function prefetchThread(thread: ThreadSummary) {
		void loadThreadHistory(thread).catch(() => undefined);
	}

	async function deleteThread(thread: ThreadSummary) {
		if (deletingThreadId) {
			return;
		}

		if (!confirm(`Delete "${thread.title}"?`)) {
			return;
		}

		deletingThreadId = thread.id;
		threadError = '';

		try {
			const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				throw new Error('Could not delete the thread.');
			}

			deleteThreadHistory(thread.id);
			if (activeThreadId === thread.id) {
				await goto(resolve('/'), { invalidateAll: true });
			} else {
				await invalidateAll();
			}
		} catch (error) {
			threadError = error instanceof Error ? error.message : 'Could not delete the thread.';
		} finally {
			deletingThreadId = null;
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
	<aside class="sidebar">
		<header>
			<div>
				<span class="brand-mark">F</span>
				<strong>Flue</strong>
			</div>
			<div class="sidebar-actions">
				<button
					type="button"
					class="theme-toggle"
					aria-label={darkMode ? 'Use light theme' : 'Use dark theme'}
					aria-pressed={darkMode}
					title={darkMode ? 'Use light theme' : 'Use dark theme'}
					onclick={toggleTheme}
				>
					{#if darkMode}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="3.5"></circle>
							<path
								d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
							></path>
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z"></path>
						</svg>
					{/if}
				</button>
				<a class="new-thread" href={resolve('/')}>New thread</a>
			</div>
		</header>

		<nav aria-label="Conversation history">
			{#each data.threads as thread (thread.id)}
				<div class="thread-row">
					<a
						href={resolve('/chat/[id]', { id: thread.id })}
						aria-current={activeThreadId === thread.id ? 'page' : undefined}
						onfocus={() => prefetchThread(thread)}
						onpointerenter={() => prefetchThread(thread)}
					>
						<strong>{thread.title}</strong>
						<span>{new Date(thread.updatedAt).toLocaleDateString()}</span>
					</a>
					<button
						type="button"
						class="delete-thread"
						aria-label={`Delete ${thread.title}`}
						title="Delete thread"
						disabled={deletingThreadId !== null}
						onclick={() => deleteThread(thread)}
					>
						{deletingThreadId === thread.id ? '…' : '×'}
					</button>
				</div>
			{:else}
				<p>No threads yet.</p>
			{/each}
		</nav>

		{#if threadError}
			<p class="sidebar-error">{threadError}</p>
		{/if}
	</aside>

	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	:global(:root) {
		color-scheme: light;
		--background: #fafafa;
		--sidebar: #f4f4f5;
		--surface: #ffffff;
		--surface-raised: rgba(255, 255, 255, 0.94);
		--text: #18181b;
		--text-soft: #27272a;
		--text-muted: #71717a;
		--text-faint: #a1a1aa;
		--border: #e4e4e7;
		--border-strong: #d4d4d8;
		--contrast: #18181b;
		--contrast-text: #ffffff;
		--hover: #ffffff;
		--code-surface: #fafafa;
		--danger-surface: #fef2f2;
		--danger-hover: #fee2e2;
		--danger-border: #fecaca;
		--danger-text: #b91c1c;
		--success-surface: #ecfdf5;
		--success-text: #047857;
		--shadow: rgba(24, 24, 27, 0.1);
		--shadow-strong: rgba(24, 24, 27, 0.16);
	}

	:global(:root[data-theme='dark']) {
		color-scheme: dark;
		--background: #101010;
		--sidebar: #171717;
		--surface: #1c1c1c;
		--surface-raised: rgba(28, 28, 28, 0.94);
		--text: #f5f5f5;
		--text-soft: #e5e5e5;
		--text-muted: #a3a3a3;
		--text-faint: #737373;
		--border: #2a2a2a;
		--border-strong: #3a3a3a;
		--contrast: #e5e5e5;
		--contrast-text: #171717;
		--hover: #222222;
		--code-surface: #151515;
		--danger-surface: #2a1717;
		--danger-hover: #351919;
		--danger-border: #5c2929;
		--danger-text: #fca5a5;
		--success-surface: #14251d;
		--success-text: #6ee7b7;
		--shadow: rgba(0, 0, 0, 0.28);
		--shadow-strong: rgba(0, 0, 0, 0.4);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) {
			color-scheme: dark;
			--background: #101010;
			--sidebar: #171717;
			--surface: #1c1c1c;
			--surface-raised: rgba(28, 28, 28, 0.94);
			--text: #f5f5f5;
			--text-soft: #e5e5e5;
			--text-muted: #a3a3a3;
			--text-faint: #737373;
			--border: #2a2a2a;
			--border-strong: #3a3a3a;
			--contrast: #e5e5e5;
			--contrast-text: #171717;
			--hover: #222222;
			--code-surface: #151515;
			--danger-surface: #2a1717;
			--danger-hover: #351919;
			--danger-border: #5c2929;
			--danger-text: #fca5a5;
			--success-surface: #14251d;
			--success-text: #6ee7b7;
			--shadow: rgba(0, 0, 0, 0.28);
			--shadow-strong: rgba(0, 0, 0, 0.4);
		}
	}

	:global(body) {
		overflow: hidden;
	}

	.app-shell {
		display: grid;
		height: 100vh;
		grid-template-columns: 250px minmax(0, 1fr);
		background: var(--background);
	}

	.sidebar {
		display: grid;
		min-height: 0;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 14px;
		border-right: 1px solid var(--border);
		background: var(--sidebar);
		padding: 16px 12px;
	}

	.sidebar header,
	.sidebar header > div {
		display: flex;
		align-items: center;
	}

	.sidebar header {
		justify-content: space-between;
		gap: 10px;
	}

	.sidebar header > div {
		gap: 8px;
	}

	.sidebar-actions {
		gap: 6px;
	}

	.brand-mark {
		display: grid;
		width: 26px;
		height: 26px;
		place-items: center;
		border-radius: 7px;
		background: var(--contrast);
		color: var(--contrast-text);
		font-size: 0.75rem;
		font-weight: 800;
	}

	.sidebar header strong {
		color: var(--text);
		font-size: 0.9rem;
	}

	.new-thread,
	.theme-toggle {
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-soft);
	}

	.new-thread {
		display: flex;
		min-height: 44px;
		align-items: center;
		padding: 7px 10px;
		font-size: 0.68rem;
		font-weight: 700;
		text-decoration: none;
	}

	.theme-toggle {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		cursor: pointer;
	}

	.theme-toggle:hover,
	.new-thread:hover {
		background: var(--hover);
	}

	.theme-toggle svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.sidebar nav {
		display: grid;
		align-content: start;
		gap: 4px;
		overflow-y: auto;
	}

	.thread-row {
		position: relative;
	}

	.thread-row > a {
		display: grid;
		min-height: 52px;
		gap: 3px;
		border-radius: 8px;
		padding: 9px 50px 9px 10px;
		color: var(--text-muted);
		text-decoration: none;
	}

	.thread-row > a:hover,
	.thread-row > a[aria-current='page'] {
		background: var(--hover);
		color: var(--text);
	}

	.thread-row > a strong {
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread-row > a span,
	.sidebar nav > p,
	.sidebar-error {
		color: var(--text-faint);
		font-size: 0.62rem;
	}

	.delete-thread {
		position: absolute;
		top: 50%;
		right: 0;
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		transform: translateY(-50%);
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-faint);
		font: inherit;
		font-size: 1rem;
		cursor: pointer;
	}

	.delete-thread:hover {
		background: var(--danger-hover);
		color: var(--danger-text);
	}

	.delete-thread:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.sidebar nav > p {
		padding: 10px;
	}

	.sidebar-error {
		color: var(--danger-text);
	}

	.content {
		position: relative;
		min-width: 0;
		min-height: 0;
	}

	@media (max-width: 760px) {
		.app-shell {
			grid-template-rows: auto minmax(0, 1fr);
			grid-template-columns: 1fr;
		}

		.sidebar {
			grid-template-rows: auto auto;
			border-right: 0;
			border-bottom: 1px solid var(--border);
			padding: 10px 12px;
		}

		.sidebar nav {
			display: flex;
			overflow-x: auto;
		}

		.thread-row {
			width: 150px;
			flex: 0 0 auto;
		}

		.sidebar-error {
			display: none;
		}
	}
</style>
