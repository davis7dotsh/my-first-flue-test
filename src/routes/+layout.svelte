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
				<a class="new-thread" href={resolve('/')} title="New thread" aria-label="New thread">
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M12 5v14M5 12h14"></path>
					</svg>
				</a>
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
		color-scheme: dark;
		--background: #03050a;
		--background-gradient: radial-gradient(ellipse 80% 60% at 50% 0%, #07101f 0%, #03050a 70%);
		--sidebar: #04070e;
		--sidebar-gradient: linear-gradient(180deg, #06101e 0%, #03050a 100%);
		--surface: #070c16;
		--surface-raised: rgba(7, 12, 22, 0.92);
		--text: #dce4f0;
		--text-soft: #a8b4c8;
		--text-muted: #5a6478;
		--text-faint: #363e50;
		--border: #0a1120;
		--border-strong: #121a2e;
		--contrast: #1e40af;
		--contrast-text: #ffffff;
		--accent: #2563eb;
		--accent-glow: rgba(37, 99, 235, 0.15);
		--accent-soft: rgba(37, 99, 235, 0.08);
		--hover: #0a1220;
		--code-surface: #050a14;
		--danger-surface: #0e0608;
		--danger-hover: #18080c;
		--danger-border: #2a1018;
		--danger-text: #dc6470;
		--success-surface: #040c08;
		--success-text: #2dbd8e;
		--status-success: #16a34a;
		--status-error: #dc2626;
		--status-warning: #d97706;
		--shadow: rgba(0, 0, 0, 0.5);
		--shadow-strong: rgba(0, 0, 0, 0.7);
		--noise-opacity: 0.06;
		--noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.08 0 0 0 0 0.12 0 0 0 0 0.25 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
	}

	:global(:root[data-theme='dark']) {
		color-scheme: dark;
		--background: #03050a;
		--background-gradient: radial-gradient(ellipse 80% 60% at 50% 0%, #07101f 0%, #03050a 70%);
		--sidebar: #04070e;
		--sidebar-gradient: linear-gradient(180deg, #06101e 0%, #03050a 100%);
		--surface: #070c16;
		--surface-raised: rgba(7, 12, 22, 0.92);
		--text: #dce4f0;
		--text-soft: #a8b4c8;
		--text-muted: #5a6478;
		--text-faint: #363e50;
		--border: #0a1120;
		--border-strong: #121a2e;
		--contrast: #1e40af;
		--contrast-text: #ffffff;
		--accent: #2563eb;
		--accent-glow: rgba(37, 99, 235, 0.15);
		--accent-soft: rgba(37, 99, 235, 0.08);
		--hover: #0a1220;
		--code-surface: #050a14;
		--danger-surface: #0e0608;
		--danger-hover: #18080c;
		--danger-border: #2a1018;
		--danger-text: #dc6470;
		--success-surface: #040c08;
		--success-text: #2dbd8e;
		--status-success: #16a34a;
		--status-error: #dc2626;
		--status-warning: #d97706;
		--shadow: rgba(0, 0, 0, 0.5);
		--shadow-strong: rgba(0, 0, 0, 0.7);
		--noise-opacity: 0.06;
		--noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.08 0 0 0 0 0.12 0 0 0 0 0.25 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) {
			color-scheme: dark;
			--background: #03050a;
			--background-gradient: radial-gradient(ellipse 80% 60% at 50% 0%, #07101f 0%, #03050a 70%);
			--sidebar: #04070e;
			--sidebar-gradient: linear-gradient(180deg, #06101e 0%, #03050a 100%);
			--surface: #070c16;
			--surface-raised: rgba(7, 12, 22, 0.92);
			--text: #dce4f0;
			--text-soft: #a8b4c8;
			--text-muted: #5a6478;
			--text-faint: #363e50;
			--border: #0a1120;
			--border-strong: #121a2e;
			--contrast: #1e40af;
			--contrast-text: #ffffff;
			--accent: #2563eb;
			--accent-glow: rgba(37, 99, 235, 0.15);
			--accent-soft: rgba(37, 99, 235, 0.08);
			--hover: #0a1220;
			--code-surface: #050a14;
			--danger-surface: #0e0608;
			--danger-hover: #18080c;
			--danger-border: #2a1018;
			--danger-text: #dc6470;
			--success-surface: #040c08;
			--success-text: #2dbd8e;
			--status-success: #16a34a;
			--status-error: #dc2626;
			--status-warning: #d97706;
			--shadow: rgba(0, 0, 0, 0.5);
			--shadow-strong: rgba(0, 0, 0, 0.7);
			--noise-opacity: 0.06;
			--noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.08 0 0 0 0 0.12 0 0 0 0 0.25 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
		}
	}

	:global(body) {
		overflow: hidden;
	}

	.app-shell {
		display: grid;
		height: 100vh;
		grid-template-columns: 250px minmax(0, 1fr);
		background: var(--background-gradient);
		position: relative;
	}

	.app-shell::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--noise);
		opacity: var(--noise-opacity);
		pointer-events: none;
		z-index: 0;
	}

	.sidebar {
		display: grid;
		min-height: 0;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 14px;
		border-right: 1px solid var(--border);
		background: var(--sidebar-gradient);
		padding: 16px 12px;
		position: relative;
		z-index: 1;
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
		background: linear-gradient(135deg, var(--accent), var(--contrast));
		color: var(--contrast-text);
		font-size: 0.75rem;
		font-weight: 800;
		box-shadow: 0 2px 12px var(--accent-glow);
	}

	.sidebar header strong {
		color: var(--text);
		font-size: 0.9rem;
	}

	.new-thread,
	.theme-toggle {
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-faint);
	}

	.new-thread {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		padding: 0;
		text-decoration: none;
	}

	.theme-toggle {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		padding: 0;
		cursor: pointer;
	}

	.new-thread:hover,
	.theme-toggle:hover {
		background: transparent;
		color: var(--accent);
	}

	.theme-toggle svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.new-thread svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
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
		min-height: 44px;
		gap: 3px;
		border-radius: 6px;
		padding: 8px 36px 8px 10px;
		color: var(--text-muted);
		text-decoration: none;
	}

	.thread-row > a:hover,
	.thread-row > a[aria-current='page'] {
		color: var(--text-soft);
	}

	.thread-row > a[aria-current='page'] {
		border-left: 2px solid var(--accent);
		padding-left: 8px;
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
		z-index: 1;
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
