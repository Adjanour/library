<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ContentIndexStats, type ReadingDashboard, type Stats } from '$lib/api';

  let reading = $state<ReadingDashboard | null>(null);
  let stats = $state<Stats | null>(null);
  let index = $state<ContentIndexStats | null>(null);
  let error = $state('');

  const typeCount = $derived(stats ? Object.values(stats.by_type).reduce((total, count) => total + count, 0) : 0);
  const indexedPercent = $derived(index && index.total > 0 ? Math.round((index.indexed / index.total) * 100) : 0);
  const indexLabel = $derived(!index ? 'Loading' : index.pending > 0 ? `${index.pending} awaiting index` : index.failed > 0 ? `${index.failed} need attention` : 'Up to date');
  const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));

  onMount(async () => {
    try {
      [reading, stats, index] = await Promise.all([api.readingDashboard(), api.stats(), api.contentIndexStats()]);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load your library overview.';
    }
  });
</script>

<div class="h-full overflow-y-auto">
  <div class="mx-auto w-full max-w-6xl space-y-7 p-6 pb-10">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Your workspace</p><h1 class="mt-1 text-2xl font-semibold tracking-[-0.02em]">Library Dashboard</h1><p class="mt-2 text-sm text-text-secondary">Pick up where you left off, or keep your catalog in shape.</p></div>
      <div class="flex flex-wrap gap-2"><a class="ui-button-primary px-3 py-2 text-xs" href="/library">Browse library</a><a class="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-2" href="/review">Review metadata</a></div>
    </header>

    {#if error}
      <section class="rounded-xl border border-error/30 bg-error/5 p-5"><h2 class="font-medium">Dashboard unavailable</h2><p class="mt-1 text-sm text-text-secondary">{error}</p></section>
    {:else if !reading || !stats || !index}
      <div class="grid gap-4 md:grid-cols-3" aria-hidden="true">{#each [0, 1, 2] as _}<div class="h-36 animate-pulse rounded-xl border border-border bg-surface-1"></div>{/each}</div>
    {:else}
      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <a class="rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2" href="/library"><p class="text-xs text-text-secondary">Catalog</p><p class="mt-2 text-2xl font-semibold tabular-nums">{stats.total_items}</p><p class="mt-1 text-xs text-text-muted">{typeCount} documents and books</p></a>
        <a class="rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2" href="/continue"><p class="text-xs text-text-secondary">In progress</p><p class="mt-2 text-2xl font-semibold tabular-nums">{reading.currently_reading.length}</p><p class="mt-1 text-xs text-text-muted">{reading.today_reading_minutes} minutes today</p></a>
        <a class="rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2" href="/queue"><p class="text-xs text-text-secondary">Up next</p><p class="mt-2 text-2xl font-semibold tabular-nums">{reading.queue.length}</p><p class="mt-1 text-xs text-text-muted">{reading.week_reading_minutes} minutes this week</p></a>
        <a class="rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2" href="/diagnostics"><div class="flex justify-between gap-2"><p class="text-xs text-text-secondary">Content index</p><span class="text-[11px] text-text-muted">{indexedPercent}%</span></div><div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"><div class="h-full rounded-full bg-accent" style:width={`${indexedPercent}%`}></div></div><p class="mt-3 text-xs text-text-muted">{indexLabel}</p></a>
      </section>

      <section class="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <article class="rounded-xl border border-border bg-surface-1 p-5"><div class="flex items-center justify-between gap-3"><div><h2 class="font-semibold">Continue reading</h2><p class="mt-1 text-xs text-text-secondary">Your active documents</p></div><a class="text-xs text-accent hover:underline" href="/continue">View all</a></div>
          {#if reading.currently_reading.length === 0}<div class="mt-6 rounded-lg border border-dashed border-border px-4 py-8 text-center"><p class="text-sm font-medium">Nothing in progress</p><p class="mt-1 text-xs text-text-secondary">Open a book from your library to start reading.</p><a class="mt-3 inline-block text-xs text-accent hover:underline" href="/library">Find something to read</a></div>
          {:else}<div class="mt-5 space-y-3">{#each reading.currently_reading.slice(0, 3) as entry (entry.item.id)}<a class="block rounded-lg border border-border p-3 transition-colors hover:bg-surface-2" href={`/reader/${entry.item.id}?returnTo=${encodeURIComponent('/')}`}><div class="flex justify-between gap-3"><div class="min-w-0"><p class="truncate text-sm font-medium">{entry.item.title}</p><p class="mt-1 truncate text-xs text-text-secondary">{entry.item.authors || 'Unknown author'}</p></div><span class="shrink-0 text-xs tabular-nums text-text-secondary">{Math.round(entry.progress.progress_percent)}%</span></div><div class="mt-3 h-1 overflow-hidden rounded-full bg-surface-3"><div class="h-full rounded-full bg-accent" style:width={`${Math.max(2, entry.progress.progress_percent)}%`}></div></div></a>{/each}</div>{/if}
        </article>

        <article class="rounded-xl border border-border bg-surface-1 p-5"><div class="flex items-center justify-between gap-3"><div><h2 class="font-semibold">Queue</h2><p class="mt-1 text-xs text-text-secondary">What is next</p></div><a class="text-xs text-accent hover:underline" href="/queue">Manage</a></div>
          {#if reading.queue.length === 0}<p class="mt-6 text-sm text-text-secondary">Your queue is clear.</p><a class="mt-2 inline-block text-xs text-accent hover:underline" href="/library">Add from library</a>
          {:else}<ol class="mt-4 space-y-2">{#each reading.queue.slice(0, 5) as entry, position (entry.id)}<li class="flex items-center gap-3 rounded-lg px-2 py-2"><span class="w-4 text-xs tabular-nums text-text-muted">{position + 1}</span><div class="min-w-0"><p class="truncate text-sm">{entry.title}</p><p class="truncate text-xs text-text-muted">{entry.author || 'Unknown author'}</p></div></li>{/each}</ol>{/if}
        </article>
      </section>

      <section class="rounded-xl border border-border bg-surface-1 p-5"><div class="flex items-center justify-between gap-3"><div><h2 class="font-semibold">Recently added</h2><p class="mt-1 text-xs text-text-secondary">Latest additions to your catalog</p></div><a class="text-xs text-accent hover:underline" href="/recent">View all</a></div>
        {#if stats.recent_added.length === 0}<p class="mt-5 text-sm text-text-secondary">No documents in your library yet. Add a scan directory in Settings to begin.</p>
        {:else}<div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{#each stats.recent_added.slice(0, 6) as item (item.id)}<a class="rounded-lg border border-border px-3 py-3 transition-colors hover:bg-surface-2" href={`/reader/${item.id}?returnTo=${encodeURIComponent('/')}`}><p class="truncate text-sm font-medium">{item.title}</p><p class="mt-1 truncate text-xs text-text-secondary">{item.authors || 'Unknown author'}</p><p class="mt-2 text-[11px] text-text-muted">Added {formatDate(item.added_at)}</p></a>{/each}</div>{/if}
      </section>
    {/if}
  </div>
</div>
