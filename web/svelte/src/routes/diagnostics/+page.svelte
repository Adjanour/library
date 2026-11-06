<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ContentIndexStats } from '$lib/api';

  type StartupStage = { stage: string; duration_ms: number };
  type StartupDiagnostics = { module_elapsed_ms?: number; stages?: StartupStage[] };

  let health = $state<Record<string, unknown> | null>(null);
  let startup = $state<StartupDiagnostics | null>(null);
  let epub = $state<Record<string, unknown>[]>([]);
  let content = $state<ContentIndexStats | null>(null);
  let error = $state('');
  let loading = $state(true);

  const duration = (milliseconds: number) => milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(2)} s`;
  const status = $derived(String(health?.status ?? 'checking'));
  const fts = $derived(health?.fts === true);
  const stages = $derived(startup?.stages ?? []);
  const startupTime = $derived(startup?.module_elapsed_ms ?? 0);

  onMount(async () => {
    try {
      const result = await Promise.all([api.health(), api.startupDiagnostics(), api.epubDiagnostics(), api.contentIndexStats()]);
      health = result[0];
      startup = result[1] as StartupDiagnostics;
      epub = result[2];
      content = result[3];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load diagnostics. Try restarting Library.';
    } finally {
      loading = false;
    }
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-8 pb-10">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">System</p>
      <h2 class="mt-1 text-2xl font-semibold tracking-[-0.02em] text-pretty">Diagnostics</h2>
      <p class="mt-2 text-sm text-text-secondary">Check the local Library runtime, startup performance, and search index.</p>
    </div>
    <div class="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
      <span class="h-1.5 w-1.5 rounded-full bg-current"></span>{status === 'ok' ? 'Library is running' : 'Checking runtime…'}
    </div>
  </header>

  {#if error}
    <div class="rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error" role="alert">{error}</div>
  {:else if loading}
    <div class="grid gap-4 md:grid-cols-3" aria-label="Loading diagnostics">
      {#each Array(3) as _}<div class="h-28 animate-pulse rounded-xl border border-border bg-surface-1"></div>{/each}
    </div>
  {:else}
    <section class="grid gap-4 md:grid-cols-3" aria-label="Runtime status">
      <article class="rounded-xl border border-border bg-surface-1 p-5">
        <p class="text-xs font-medium text-text-muted">Runtime</p>
        <div class="mt-3 flex items-center gap-3"><span class="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 text-lg text-success">✓</span><div><p class="font-semibold capitalize">{status}</p><p class="text-xs text-text-secondary">Lifecycle: {String(health?.lifecycle_state ?? 'unknown')}</p></div></div>
      </article>
      <article class="rounded-xl border border-border bg-surface-1 p-5">
        <p class="text-xs font-medium text-text-muted">Search Engine</p>
        <div class="mt-3"><p class="text-xl font-semibold">{fts ? 'FTS5 enabled' : 'Fallback search'}</p><p class="mt-1 text-xs text-text-secondary">{fts ? 'Fast metadata & document search is available.' : 'SQLite full-text search is unavailable.'}</p></div>
      </article>
      <article class="rounded-xl border border-border bg-surface-1 p-5">
        <p class="text-xs font-medium text-text-muted">App Version</p>
        <div class="mt-3"><p class="text-xl font-semibold tabular-nums">{String(health?.version ?? '—')}</p><p class="mt-1 text-xs text-text-secondary">Running on this device</p></div>
      </article>
    </section>

    <section class="rounded-xl border border-border bg-surface-1">
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4"><div><h3 class="font-semibold">Startup Performance</h3><p class="mt-1 text-sm text-text-secondary">Time spent initializing each local service.</p></div><span class="text-sm font-medium tabular-nums">{duration(startupTime)} total</span></div>
      {#if stages.length}
        <div class="divide-y divide-border">
          {#each stages as stage}<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3"><div class="min-w-0"><p class="truncate text-sm font-medium capitalize">{stage.stage.replaceAll('_', ' ')}</p><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div class="h-full rounded-full bg-accent" style:width={`${Math.max(3, (stage.duration_ms / Math.max(...stages.map((item) => item.duration_ms))) * 100)}%`}></div></div></div><span class="text-sm tabular-nums text-text-secondary">{duration(stage.duration_ms)}</span></div>{/each}
        </div>
      {:else}<p class="px-5 py-8 text-sm text-text-muted">No startup timings were recorded.</p>{/if}
    </section>

    <section class="rounded-xl border border-border bg-surface-1">
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4"><div><h3 class="font-semibold">Document Content Index</h3><p class="mt-1 text-sm text-text-secondary">Text extracted locally from your PDFs & EPUBs for inside-document search.</p></div>{#if content}<span class="text-sm tabular-nums text-text-secondary">{content.total} items</span>{/if}</div>
      {#if content}<div class="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-6">{#each [['Indexed', content.indexed, 'text-success'], ['Truncated', content.truncated, 'text-text-primary'], ['Pending', content.pending, 'text-accent'], ['Needs OCR', content.needs_ocr, 'text-warning'], ['Failed', content.failed, 'text-error'], ['Unavailable', content.unavailable, 'text-text-muted']] as stat}<div class="p-4"><p class="text-xs text-text-muted">{stat[0]}</p><p class={`mt-1 text-2xl font-semibold tabular-nums ${stat[2]}`}>{stat[1]}</p></div>{/each}</div>{/if}
    </section>

    <section class="rounded-xl border border-border bg-surface-1"><div class="border-b border-border px-5 py-4"><h3 class="font-semibold">EPUB Reader Events</h3><p class="mt-1 text-sm text-text-secondary">Recent local reader diagnostics, recorded when a rendition attempt fails.</p></div>{#if epub.length}<div class="max-h-80 overflow-auto p-3 space-y-2">{#each epub as event, index}<details class="rounded-lg border border-border bg-surface-2"><summary class="cursor-pointer px-3 py-2 text-sm text-text-secondary">Event {epub.length - index}</summary><pre class="overflow-auto border-t border-border p-3 text-xs text-text-muted">{JSON.stringify(event, null, 2)}</pre></details>{/each}</div>{:else}<p class="px-5 py-8 text-sm text-text-muted">No EPUB reader events recorded.</p>{/if}</section>
  {/if}
</div>
