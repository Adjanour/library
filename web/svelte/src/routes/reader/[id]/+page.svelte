<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Reader from '$lib/components/Reader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { api, type Item } from '$lib/api';

  let item = $state<Item | null>(null);
  let loading = $state(true);
  let error = $state('');
  let returnTo = $derived.by(() => {
    const destination = page.url.searchParams.get('returnTo') ?? '/continue';
    return destination.startsWith('/') && !destination.startsWith('//') && !destination.startsWith('/reader/') ? destination : '/continue';
  });

  async function load() {
    loading = true;
    error = '';
    try { item = await api.item(Number(page.params.id)); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not open this item.'; }
    finally { loading = false; }
  }

  function closeReader() { void goto(returnTo); }
  function handleFinished(nextItemId?: number) {
    void goto(nextItemId ? `/reader/${nextItemId}?returnTo=${encodeURIComponent(returnTo)}` : returnTo);
  }

  onMount(() => { void load(); });
</script>

{#if loading}
  <div class="flex min-h-screen items-center justify-center bg-surface-0 text-sm text-text-secondary">Opening reader…</div>
{:else if error}
  <div class="min-h-screen bg-surface-0 p-6"><EmptyState title="Reader could not open" message={error} actionLabel="Back to library" actionHref="/library" /></div>
{:else if item}
  <Reader {item} onClose={closeReader} onFinished={handleFinished} />
{/if}
