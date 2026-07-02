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
  class="w-full text-left px-3 py-2 border-b border-border hover:bg-surface-2 transition-colors flex items-center gap-2"
  class:bg-surface-2={isSelected}
  onclick={() => onClick(item)}
>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 text-text-muted">
    <path d={typeIcon(item.type)} />
  </svg>
  <div class="min-w-0 flex-1">
    <div class="text-sm truncate">{@html highlight(item.title, query)}</div>
    <div class="text-xs text-text-muted truncate">{item.authors || 'Unknown'} {item.year ? `(${item.year})` : ''}</div>
  </div>
  {#if item.category}
    <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">{item.category}</span>
  {/if}
  <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary shrink-0">{item.type}</span>
</button>
