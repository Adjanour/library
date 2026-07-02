<script lang="ts">
  import { highlight, typeIcon } from '$lib/utils';
  import type { Item } from '$lib/api';

  let { item, isSelected, query, onClick }: {
    item: Item;
    isSelected: boolean;
    query: string;
    onClick: (item: Item) => void;
  } = $props();
</script>

<button
  class="text-left p-3 rounded-lg border border-border hover:border-accent/50 hover:bg-surface-2 transition-all"
  class:border-accent={isSelected}
  class:bg-surface-2={isSelected}
  onclick={() => onClick(item)}
>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-1.5 text-accent/70">
    <path d={typeIcon(item.type)} />
  </svg>
  <div class="text-xs font-medium truncate leading-tight">{@html highlight(item.title, query)}</div>
  <div class="text-[10px] text-text-muted truncate mt-0.5">{item.authors || 'Unknown'}</div>
  <div class="flex items-center gap-1 mt-1.5 flex-wrap">
    <span class="text-[9px] px-1 py-0.5 rounded bg-surface-3 text-text-secondary">{item.type}</span>
    {#if item.category}
      <span class="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent">{item.category}</span>
    {/if}
    {#if item.year}<span class="text-[9px] text-text-muted ml-auto">{item.year}</span>{/if}
  </div>
</button>
