<script lang="ts">
  import { highlight, typeIcon } from '$lib/utils';
  import type { Item } from '$lib/api';

  let { item, isSelected, query, isReading = false, progressPercent = 0, bulkMode = false, isBulkSelected = false, onClick, onRead, onToggleBulk }: {
    item: Item;
    isSelected: boolean;
    query: string;
    isReading?: boolean;
    progressPercent?: number;
    bulkMode?: boolean;
    isBulkSelected?: boolean;
    onClick: (item: Item) => void;
    onRead?: (item: Item) => void;
    onToggleBulk?: (item: Item) => void;
  } = $props();
  let thumbnailFailed = $state(false);
  let supportsThumbnail = $derived(/\.(epub|pdf)$/i.test(item.filename));
  let matchSnippet = $derived(
    item.match_snippet?.replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').trim() ?? ''
  );
</script>

<article
  class="library-fade-in group min-w-0 rounded-xl border border-border bg-surface-1 p-2.5 transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/50 hover:bg-surface-2 hover:shadow-lg hover:shadow-black/10"
  class:border-accent={isSelected}
  class:bg-surface-2={isSelected}
>
  <button data-item-id={item.id} class="w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1" aria-pressed={isSelected} onclick={() => onClick(item)}>
    {#if bulkMode}
      <span class="float-right ml-2">
        <input type="checkbox" aria-label={`Select ${item.title}`} checked={isBulkSelected} onclick={(event) => { event.stopPropagation(); onToggleBulk?.(item); }} />
      </span>
    {/if}
    <div class="relative mb-2.5 flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-surface-2 shadow-inner">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.2" class="text-accent/50"><path d={typeIcon(item.type)} /></svg>
      {#if supportsThumbnail && !thumbnailFailed}<img src={`/api/thumbnail/${item.id}`} alt={`Cover of ${item.title}`} loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" onerror={() => (thumbnailFailed = true)} />{/if}
    </div>
    <div class="text-xs font-medium truncate leading-tight">{@html highlight(item.title, query)}</div>
    <div class="text-[10px] text-text-muted truncate mt-0.5">{item.authors || 'Unknown'}</div>
    {#if query && matchSnippet}
      <div class="mt-1 line-clamp-2 text-[9px] leading-tight text-text-muted">{matchSnippet}</div>
    {/if}
    <div class="flex items-center gap-1 mt-1.5 flex-wrap">
      <span class="text-[9px] px-1 py-0.5 rounded bg-surface-3 text-text-secondary">{item.type}</span>
      {#if item.category}<span class="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent">{item.category}</span>{/if}
      {#if item.year}<span class="text-[9px] text-text-muted ml-auto">{item.year}</span>{/if}
    </div>
  </button>
  {#if supportsThumbnail && onRead}
    <button class="mt-2 flex w-full items-center justify-between rounded bg-accent/10 px-2 py-1 text-[10px] text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent" onclick={() => onRead?.(item)}>
      <span>{isReading ? 'Continue reading' : 'Read book'}</span><span>{isReading ? `${progressPercent}%` : '↗'}</span>
    </button>
  {/if}
</article>
