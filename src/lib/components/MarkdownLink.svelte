<!--
@component
Sanitizes markdown link hrefs and renders them as external links.

Only `http:`, `https:`, and `mailto:` URLs (and relative URLs) are kept;
any other protocol (e.g. `javascript:`) is dropped so the link renders as
plain text. Valid links open in a new tab with `rel="noopener noreferrer"`.

@prop {string} [href] - Link destination URL.
@prop {string} [title] - Tooltip text displayed on hover.
@prop {Snippet} [children] - Rendered inline content of the link.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		href?: string;
		title?: string;
		children?: Snippet;
	}

	const { href = undefined, title = undefined, children }: Props = $props();

	function isSafeUrl(url: string): boolean {
		if (!url) {
			return false;
		}

		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
			return /^(https?:|mailto:)/i.test(url);
		}

		// Relative URLs (including protocol-relative `//host`) are allowed.
		return true;
	}

	const safeHref = $derived(href && isSafeUrl(href) ? href : undefined);
</script>

{#if safeHref}
	<a href={safeHref} {title} target="_blank" rel="external noopener noreferrer">
		{@render children?.()}
		<span class="sr-only">(opens in a new tab)</span>
	</a>
{:else}
	{@render children?.()}
{/if}

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
