<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { api, type ReadingDashboard } from '$lib/api';
  let dashboard = $state<ReadingDashboard | null>(null);
  let error = $state('');
  // Progress bars spring to their value shortly after the cards mount.
  let barsMounted = $state(false);
  onMount(async () => {
    try {
      await api.bootstrap();
      const [nextDashboard, settings] = await Promise.all([api.readingDashboard(), api.settings()]);
      dashboard = nextDashboard;
      requestAnimationFrame(() => (barsMounted = true));
      if (settings.smoke_item_id) void goto(`/reader/${settings.smoke_item_id}`);
    } catch (e) { error = e instanceof Error ? e.message : 'Runtime unavailable'; }
  });
</script>
  {#if error}<EmptyState title="Library runtime unavailable" message={error} actionLabel="Retry" actionHref="/continue" />
  {:else if !dashboard}
    <div class="grid gap-4 md:grid-cols-2" aria-hidden="true">
      {#each [0, 1] as _}
        <div class="rounded-xl border border-border bg-surface-1 p-6">
          <Skeleton className="h-2.5 w-16 rounded" />
          <Skeleton className="mt-3 h-5 w-2/3 rounded" />
          <Skeleton className="mt-2 h-3 w-1/3 rounded" />
          <Skeleton className="mt-4 h-1 w-full rounded" />
        </div>
      {/each}
    </div>
  {:else if dashboard.currently_reading.length === 0}<EmptyState title="Nothing in progress" message="Choose a book from your library or add one to the queue when you are ready." />
  {:else}
    <div class="grid gap-4 md:grid-cols-2">{#each dashboard.currently_reading as entry}<a class="library-fade-in group rounded-xl border border-border bg-surface-1 p-6 transition-colors hover:bg-surface-2" href={`/reader/${entry.item.id}?returnTo=${encodeURIComponent('/continue')}`}><p class="text-xs uppercase tracking-wide text-text-secondary">Continue</p><h2 class="mt-2 text-lg font-medium tracking-[-0.015em]">{entry.item.title}</h2><p class="mt-2 text-sm text-text-secondary">{Math.round(entry.progress.progress_percent)}% · {entry.item.authors}</p><div class="progress-track mt-3 h-1" role="progressbar" aria-valuenow={Math.round(entry.progress.progress_percent)} aria-valuemin="0" aria-valuemax="100" aria-label={`Progress in ${entry.item.title}`}><div class="progress-fill" style:width={barsMounted ? `${Math.min(100, Math.max(2, entry.progress.progress_percent))}%` : '0%'}></div></div></a>{/each}</div>
  {/if}
