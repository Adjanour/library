<script lang="ts">
  import type { Item } from '$lib/api';
  import { formatSize } from '$lib/utils';

  let { items, selectedId, onSelect, onRead, bulkMode = false, bulkSelected = new Set<number>(), onToggleBulk }: {
    items: Item[];
    selectedId?: number;
    onSelect: (item: Item) => void;
    onRead: (item: Item) => void;
    bulkMode?: boolean;
    bulkSelected?: Set<number>;
    onToggleBulk?: (item: Item) => void;
  } = $props();
</script>

<div class="overflow-hidden rounded-xl border border-border bg-surface-1">
  <div class="overflow-x-auto">
    <table class="w-full table-fixed border-collapse text-left text-[11px]">
      <thead class="border-b border-border bg-surface-2/70 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
        <tr>
          <th class="w-12 px-2 py-2"><span class="sr-only">Select</span></th>
          <th class="w-[35%] px-2 py-2">Title</th>
          <th class="w-[24%] px-2 py-2">Author</th>
          <th class="w-[15%] px-2 py-2">Category</th>
          <th class="w-20 px-2 py-2">Format</th>
          <th class="w-16 px-2 py-2 text-right">Year</th>
          <th class="w-20 px-2 py-2 text-right">Size</th>
          <th class="w-16 px-2 py-2"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each items as item (item.id)}
          <tr class="group border-b border-border/70 last:border-b-0 hover:bg-surface-2" class:bg-surface-2={selectedId === item.id}>
            <td class="p-1.5 pl-2">
              {#if bulkMode}<input type="checkbox" aria-label={`Select ${item.title}`} checked={bulkSelected.has(item.id)} onclick={(event) => { event.stopPropagation(); onToggleBulk?.(item); }} />{/if}
              <button class="block h-10 w-8 overflow-hidden rounded bg-surface-3" aria-label={`Select ${item.title}`} onclick={() => onSelect(item)}>
                <img src={`/api/thumbnail/${item.id}`} alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" onerror={(event) => ((event.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
              </button>
            </td>
            <td class="px-2 py-2">
              <button class="block w-full truncate text-left font-medium text-text-primary" onclick={() => onSelect(item)}>{item.title}</button>
            </td>
            <td class="truncate px-2 py-2 text-text-secondary">{item.authors || 'Unknown'}</td>
            <td class="truncate px-2 py-2 text-text-secondary">{item.category || '—'}</td>
            <td class="px-2 py-2 uppercase text-text-muted">{item.filename.split('.').pop() || item.type}</td>
            <td class="px-2 py-2 text-right tabular-nums text-text-muted">{item.year || '—'}</td>
            <td class="px-2 py-2 text-right tabular-nums text-text-muted">{formatSize(item.size)}</td>
            <td class="px-2 py-2 text-right">
              {#if /\.(epub|pdf)$/i.test(item.filename)}
                <button class="rounded-md bg-accent/10 px-2 py-1 text-accent transition-colors hover:bg-accent/20" onclick={() => onRead(item)}>Read</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
