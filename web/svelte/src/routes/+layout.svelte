<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import AppShell from '$lib/components/AppShell.svelte';
  import ToastLayer from '$lib/components/ToastLayer.svelte';

  let { children } = $props();

  const titles: Record<string, string> = {
    '/': 'Dashboard',
    '/continue': 'Continue Reading',
    '/queue': 'Queue',
    '/recent': 'Recent',
    '/collections': 'Collections',
    '/library': 'All Library',
    '/review': 'Metadata Review',
    '/settings': 'Settings',
    '/diagnostics': 'Diagnostics',
    '/shortcuts': 'Shortcuts'
  };

  const title = $derived(titles[page.url.pathname] ?? 'Library');
  // The reader fills the window on its own; everything else gets the shell.
  const chrome = $derived(!page.url.pathname.startsWith('/reader'));
</script>

<div class="flex h-screen flex-col bg-surface-0">
  {#if chrome}
    <AppShell {title}>{@render children()}</AppShell>
  {:else}
    {@render children()}
  {/if}
  <ToastLayer />
</div>
