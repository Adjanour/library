<script lang="ts">
  let { items = [], selectedId = null, onSelect = () => {} }: {
    items?: { id: number; title: string; subtitle?: string }[];
    selectedId?: number | null;
    onSelect?: (id: number) => void;
  } = $props();
</script>
<div role="listbox" aria-label="Items" class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-1">
  {#each items as item (item.id)}
    <button class:selected={item.id === selectedId} class="block w-full px-4 py-3 text-left hover:bg-surface-2" role="option" aria-selected={item.id === selectedId} onclick={() => onSelect(item.id)}>
      <span class="block text-sm">{item.title}</span><span class="text-xs text-text-secondary">{item.subtitle ?? ''}</span>
    </button>
  {/each}
</div>
<style>button.selected { background: var(--surface-3); }</style>
