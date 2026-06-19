<!--
@component
Syntax-highlighted fenced code block renderer for `@humanspeak/svelte-markdown`.

Replaces the built-in `code` renderer. Receives the language identifier and raw
text from the markdown parser, highlights the text with highlight.js (sync), and
emits `<pre><code class="hljs">…</code></pre>` so the existing `:global(.prose pre)`
styles continue to apply.

- Sync highlighting keeps streaming re-renders (per text delta) flash-free.
- Only a curated set of common languages is registered to keep the bundle small.
- Unknown/missing languages fall back to safely escaped plain text.
- Partial (streaming) code blocks never throw; highlight.js tolerates incomplete
  input and any unexpected error falls back to escaped text.
- Theming uses CSS custom properties that adapt to the project's
  `data-theme="dark"` attribute and `prefers-color-scheme` media query.

@prop {string} lang - Language identifier from the code fence (e.g. `"js"`, `"ts"`).
@prop {string} text - Raw text content of the code block.
-->
<script lang="ts">
	/* eslint-disable svelte/no-at-html-tags -- highlight.js output is XSS-safe:
	   it escapes all source text and only emits <span class="hljs-*"> wrappers. */
	import hljs from 'highlight.js/lib/core';
	import javascript from 'highlight.js/lib/languages/javascript';
	import typescript from 'highlight.js/lib/languages/typescript';
	import xml from 'highlight.js/lib/languages/xml';
	import css from 'highlight.js/lib/languages/css';
	import json from 'highlight.js/lib/languages/json';
	import yaml from 'highlight.js/lib/languages/yaml';
	import bash from 'highlight.js/lib/languages/bash';
	import shell from 'highlight.js/lib/languages/shell';
	import python from 'highlight.js/lib/languages/python';
	import go from 'highlight.js/lib/languages/go';
	import rust from 'highlight.js/lib/languages/rust';
	import sql from 'highlight.js/lib/languages/sql';
	import markdown from 'highlight.js/lib/languages/markdown';
	import diff from 'highlight.js/lib/languages/diff';
	import plaintext from 'highlight.js/lib/languages/plaintext';

	interface Props {
		lang: string;
		text: string;
	}

	const { lang, text }: Props = $props();

	// Register a curated set of common languages once.
	// Individual imports keep the bundle tree-shakeable and small.
	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('js', javascript);
	hljs.registerLanguage('jsx', javascript);
	hljs.registerLanguage('typescript', typescript);
	hljs.registerLanguage('ts', typescript);
	hljs.registerLanguage('tsx', typescript);
	hljs.registerLanguage('xml', xml);
	hljs.registerLanguage('html', xml);
	hljs.registerLanguage('svelte', xml);
	hljs.registerLanguage('css', css);
	hljs.registerLanguage('json', json);
	hljs.registerLanguage('yaml', yaml);
	hljs.registerLanguage('yml', yaml);
	hljs.registerLanguage('bash', bash);
	hljs.registerLanguage('sh', bash);
	hljs.registerLanguage('shell', shell);
	hljs.registerLanguage('python', python);
	hljs.registerLanguage('py', python);
	hljs.registerLanguage('go', go);
	hljs.registerLanguage('rust', rust);
	hljs.registerLanguage('rs', rust);
	hljs.registerLanguage('sql', sql);
	hljs.registerLanguage('markdown', markdown);
	hljs.registerLanguage('md', markdown);
	hljs.registerLanguage('diff', diff);
	hljs.registerLanguage('plaintext', plaintext);
	hljs.registerLanguage('text', plaintext);

	function escapeHtml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// Sync highlighting. `$derived` caches per unique (lang, text) so repeated
	// renders with unchanged input do not re-parse. Falls back to escaped plain
	// text for unknown languages, empty language, or any highlighter error.
	const highlighted = $derived.by(() => {
		const code = text ?? '';
		const language = (lang ?? '').trim().toLowerCase();

		if (!language) {
			return escapeHtml(code);
		}

		try {
			if (hljs.getLanguage(language)) {
				return hljs.highlight(code, { language, ignoreIllegals: true }).value;
			}
		} catch {
			// Fall through to plain text on any unexpected error.
		}

		return escapeHtml(code);
	});
</script>

<pre class={lang || undefined}><code class="hljs">{@html highlighted}</code></pre>

<style>
	/* Token colors adapted for the deep blue theme. */
	:global(:root) {
		--hl-comment: #4a5470;
		--hl-keyword: #7c9eff;
		--hl-string: #4ec9a0;
		--hl-number: #b888ff;
		--hl-literal: #b888ff;
		--hl-built-in: #6ba6ff;
		--hl-type: #6ba6ff;
		--hl-function: #7c9eff;
		--hl-title: #7c9eff;
		--hl-attr: #6ba6ff;
		--hl-attribute: #6ba6ff;
		--hl-tag: #4ec9a0;
		--hl-name: #4ec9a0;
		--hl-variable: #d4a860;
		--hl-property: #6ba6ff;
		--hl-meta: #4a5470;
		--hl-regexp: #4ec9a0;
		--hl-symbol: #b888ff;
		--hl-addition: #4ec9a0;
		--hl-deletion: #e06070;
		--hl-text: var(--text-soft);
	}

	:global(:root[data-theme='dark']) {
		--hl-comment: #4a5470;
		--hl-keyword: #7c9eff;
		--hl-string: #4ec9a0;
		--hl-number: #b888ff;
		--hl-literal: #b888ff;
		--hl-built-in: #6ba6ff;
		--hl-type: #6ba6ff;
		--hl-function: #7c9eff;
		--hl-title: #7c9eff;
		--hl-attr: #6ba6ff;
		--hl-attribute: #6ba6ff;
		--hl-tag: #4ec9a0;
		--hl-name: #4ec9a0;
		--hl-variable: #d4a860;
		--hl-property: #6ba6ff;
		--hl-meta: #4a5470;
		--hl-regexp: #4ec9a0;
		--hl-symbol: #b888ff;
		--hl-addition: #4ec9a0;
		--hl-deletion: #e06070;
		--hl-text: var(--text-soft);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) {
			--hl-comment: #4a5470;
			--hl-keyword: #7c9eff;
			--hl-string: #4ec9a0;
			--hl-number: #b888ff;
			--hl-literal: #b888ff;
			--hl-built-in: #6ba6ff;
			--hl-type: #6ba6ff;
			--hl-function: #7c9eff;
			--hl-title: #7c9eff;
			--hl-attr: #6ba6ff;
			--hl-attribute: #6ba6ff;
			--hl-tag: #4ec9a0;
			--hl-name: #4ec9a0;
			--hl-variable: #d4a860;
			--hl-property: #6ba6ff;
			--hl-meta: #4a5470;
			--hl-regexp: #4ec9a0;
			--hl-symbol: #b888ff;
			--hl-addition: #4ec9a0;
			--hl-deletion: #e06070;
			--hl-text: var(--text-soft);
		}
	}

	:global(.prose pre code.hljs) {
		display: block;
		color: var(--hl-text);
		background: none;
		padding: 0;
	}

	:global(.prose pre .hljs-comment),
	:global(.prose pre .hljs-quote),
	:global(.prose pre .hljs-meta) {
		color: var(--hl-comment);
		font-style: italic;
	}

	:global(.prose pre .hljs-keyword),
	:global(.prose pre .hljs-selector-tag),
	:global(.prose pre .hljs-deletion) {
		color: var(--hl-keyword);
	}

	:global(.prose pre .hljs-string),
	:global(.prose pre .hljs-regexp),
	:global(.prose pre .hljs-addition),
	:global(.prose pre .hljs-meta .hljs-string) {
		color: var(--hl-string);
	}

	:global(.prose pre .hljs-number),
	:global(.prose pre .hljs-literal),
	:global(.prose pre .hljs-symbol),
	:global(.prose pre .hljs-bullet) {
		color: var(--hl-number);
	}

	:global(.prose pre .hljs-built_in),
	:global(.prose pre .hljs-type),
	:global(.prose pre .hljs-class .hljs-title) {
		color: var(--hl-built-in);
	}

	:global(.prose pre .hljs-function .hljs-title),
	:global(.prose pre .hljs-title),
	:global(.prose pre .hljs-title.function_) {
		color: var(--hl-function);
	}

	:global(.prose pre .hljs-attr),
	:global(.prose pre .hljs-attribute),
	:global(.prose pre .hljs-property),
	:global(.prose pre .hljs-variable) {
		color: var(--hl-attr);
	}

	:global(.prose pre .hljs-tag),
	:global(.prose pre .hljs-name),
	:global(.prose pre .hljs-section) {
		color: var(--hl-tag);
	}

	:global(.prose pre .hljs-params),
	:global(.prose pre .hljs-template-variable),
	:global(.prose pre .hljs-template-tag) {
		color: var(--hl-variable);
	}

	:global(.prose pre .hljs-emphasis) {
		font-style: italic;
	}

	:global(.prose pre .hljs-strong) {
		font-weight: 700;
	}
</style>
