<script lang="ts">
  import { highlight, typeIcon } from '$lib/utils';
  import type { Item } from '$lib/api';

  let { item, isSelected, query, isReading = false, progressPercent = 0, onClick, onRead }: {
    item: Item;
    isSelected: boolean;
    query: string;
    isReading?: boolean;
    progressPercent?: number;
    onClick: (item: Item) => void;
    onRead?: (item: Item) => void;
  } = $props();
</script>

<article
  class="group rounded-lg border border-border border-l-2 border-l-transparent bg-surface-1 p-3 transition-colors hover:border-accent/50 hover:bg-surface-2"
  class:border-l-accent={isSelected}
  class:bg-surface-2={isSelected}
>
  <button data-item-id={item.id} class="w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1" aria-pressed={isSelected} onclick={() => onClick(item)}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-1.5 text-accent/70"><path d={typeIcon(item.type)} /></svg>
    <div class="text-xs font-medium truncate leading-tight">{@html highlight(item.title, query)}</div>
    <div class="text-[10px] text-text-muted truncate mt-0.5">{item.authors || 'Unknown'}</div>
    <div class="flex items-center gap-1 mt-1.5 flex-wrap">
      <span class="text-[9px] px-1 py-0.5 rounded bg-surface-3 text-text-secondary">{item.type}</span>
      {#if item.category}<span class="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent">{item.category}</span>{/if}
      {#if item.year}<span class="text-[9px] text-text-muted ml-auto">{item.year}</span>{/if}
    </div>
  </button>
  {#if isReading && onRead}
    <button class="mt-2 flex w-full items-center justify-between rounded bg-accent/10 px-2 py-1 text-[10px] text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent" onclick={() => onRead?.(item)}>
      <span>Continue</span><span>{progressPercent}%</span>
    </button>
  {/if}
</article>
