<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type PendingMetadataSuggestion } from '$lib/api';
  import { toast } from '$lib/toast.svelte';

  let suggestions = $state<PendingMetadataSuggestion[]>([]);
  let loading = $state(true);
  let resolving = $state<number | null>(null);
  let source = $state('');

  const visible = $derived(source ? suggestions.filter((suggestion) => suggestion.source === source) : suggestions);
  const sources = $derived([...new Set(suggestions.map((suggestion) => suggestion.source))]);

  async function load() {
    loading = true;
    try { suggestions = await api.pendingMetadataSuggestions(); }
    catch { toast('Could not load metadata suggestions'); }
    finally { loading = false; }
  }

  async function resolve(suggestion: PendingMetadataSuggestion, apply: boolean) {
    resolving = suggestion.id;
    try {
      await api.resolveSuggestion(suggestion.id, apply);
      suggestions = suggestions.filter((entry) => entry.id !== suggestion.id);
      toast(apply ? `Applied ${suggestion.field} to “${suggestion.item.title}”` : 'Suggestion dismissed');
    } catch { toast('Could not update this suggestion'); }
    finally { resolving = null; }
  }

  function confidence(value: number) { return `${Math.round(value * 100)}% confidence`; }
  onMount(load);
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 pb-10">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div><p class="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Catalog quality</p><h2 class="mt-1 text-2xl font-semibold tracking-[-0.02em] text-pretty">Metadata Review</h2><p class="mt-2 text-sm text-text-secondary">Review suggestions from Crossref, Open Library, and GROBID before they change your catalog.</p></div>
    <span class="rounded-full border border-border bg-surface-1 px-3 py-1.5 text-sm tabular-nums text-text-secondary">{suggestions.length} pending</span>
  </header>

  <div class="flex flex-wrap items-center gap-2 border-b border-border pb-4"><button class={`rounded-full border px-3 py-1.5 text-xs ${source === '' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`} onclick={() => source = ''}>All {suggestions.length}</button>{#each sources as item}<button class={`rounded-full border px-3 py-1.5 text-xs capitalize ${source === item ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`} onclick={() => source = item}>{item} {suggestions.filter((suggestion) => suggestion.source === item).length}</button>{/each}</div>

  {#if loading}<div class="space-y-3">{#each Array(3) as _}<div class="h-36 animate-pulse rounded-xl border border-border bg-surface-1"></div>{/each}</div>
  {:else if visible.length === 0}<section class="rounded-xl border border-dashed border-border bg-surface-1 px-6 py-14 text-center"><h3 class="font-semibold">Nothing to review</h3><p class="mt-2 text-sm text-text-secondary">Run “Find Metadata” from an item’s detail panel to collect suggestions.</p></section>
  {:else}<section class="space-y-3">{#each visible as suggestion (suggestion.id)}<article class="rounded-xl border border-border bg-surface-1 p-5"><div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><p class="truncate font-semibold">{suggestion.item.title}</p><p class="mt-1 truncate text-sm text-text-secondary">{suggestion.item.authors || 'Unknown author'} · {suggestion.item.filename}</p></div><span class="rounded-full bg-surface-3 px-2.5 py-1 text-xs capitalize text-text-secondary">{suggestion.source}</span></div><div class="mt-5 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"><div><p class="text-xs font-medium uppercase tracking-wide text-text-muted">{suggestion.field}</p><p class="mt-1 text-xs text-text-secondary">{confidence(suggestion.confidence)}</p></div><p class="break-words text-sm text-text-primary">{suggestion.value}</p><div class="flex gap-2"><button class="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50" disabled={resolving === suggestion.id} onclick={() => void resolve(suggestion, false)}>Dismiss</button><button class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50" disabled={resolving === suggestion.id} onclick={() => void resolve(suggestion, true)}>{resolving === suggestion.id ? 'Saving…' : 'Apply'}</button></div></div></article>{/each}</section>{/if}
</div>
