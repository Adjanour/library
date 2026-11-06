<script lang="ts">
  import { onMount } from 'svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { api, type ReadingQueueItem } from '$lib/api';
  import { toast } from '$lib/toast.svelte';

  let queue = $state<ReadingQueueItem[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    try { queue = await api.readingQueue(); error = ''; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load the queue.'; }
    finally { loading = false; }
  }
  function remove(item: ReadingQueueItem) {
    void api.removeFromQueue(item.id).then(() => toast(`Removed “${item.title}” from the queue`)).then(load);
  }
  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    queue = next;
    try { await api.reorderQueue(next.map((item) => item.id)); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not reorder the queue.'; await load(); }
  }
  onMount(() => { void load(); });
</script>

  {#if error}<EmptyState title="Queue unavailable" message={error} actionLabel="Retry" actionHref="/queue" />
  {:else if loading}
    <div class="space-y-2" aria-hidden="true">
      {#each [0, 1, 2, 3] as _}
        <div class="flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4">
          <Skeleton className="h-4 w-4 rounded" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3 rounded" />
            <Skeleton className="h-2 w-1/4 rounded" />
          </div>
        </div>
      {/each}
    </div>
  {:else if queue.length === 0}<EmptyState title="Your queue is empty" message="Add books from All Library to build your next reading list." actionHref="/library" />
  {:else}
    <ol class="space-y-2" aria-label="Reading queue">
      {#each queue as item, index (item.id)}
        <li class="flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4">
          <span class="w-6 text-center text-sm text-text-secondary">{index + 1}</span>
          <div class="min-w-0 flex-1">
            {#if item.item_id}<a class="truncate text-sm hover:text-accent" href={`/reader/${item.item_id}?returnTo=${encodeURIComponent('/queue')}`}>{item.title}</a>{:else}<span class="truncate text-sm">{item.title}</span>{/if}
            <p class="truncate text-xs text-text-secondary">{item.author || 'Unknown author'}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button class="rounded border border-border px-2 py-1 text-xs disabled:opacity-30" aria-label="Move up" disabled={index === 0} onclick={() => void move(index, -1)}>↑</button>
            <button class="rounded border border-border px-2 py-1 text-xs disabled:opacity-30" aria-label="Move down" disabled={index === queue.length - 1} onclick={() => void move(index, 1)}>↓</button>
            <button class="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-3" aria-label={`Remove ${item.title}`} onclick={() => void remove(item)}>Remove</button>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
