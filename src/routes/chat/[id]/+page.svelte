<script lang="ts">
	import ChatThread from '$lib/components/ChatThread.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.thread.title} · Flue</title>
	<meta name="description" content="A minimal durable Flue agent chat." />
</svelte:head>

{#key data.thread.id}
	<ChatThread thread={data.thread} />
{/key}
