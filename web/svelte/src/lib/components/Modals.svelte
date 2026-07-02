<script lang="ts">
  let {
    showDelete,
    showKeybindings,
    itemTitle,
    onConfirmDelete,
    onCancelDelete,
    onCloseKeybindings
  }: {
    showDelete: boolean;
    showKeybindings: boolean;
    itemTitle: string;
    onConfirmDelete: () => void;
    onCancelDelete: () => void;
    onCloseKeybindings: () => void;
  } = $props();

  const shortcuts = [
    ['/', 'Focus search'],
    ['j / k', 'Navigate list'],
    ['Enter / o', 'Open in reader'],
    ['r', 'Read in-app'],
    ['e', 'Edit metadata'],
    ['d', 'Delete item'],
    ['R', 'Rescan library'],
    ['g / l', 'Grid / List view'],
    ['b', 'Reading dashboard'],
    ['?', 'Toggle this help'],
    ['Esc', 'Close / Back'],
  ];
</script>

{#if showDelete}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onclick={onCancelDelete} onkeydown={(e) => e.key === 'Escape' && onCancelDelete()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-surface-1 border border-border rounded-lg p-5 w-80 shadow-xl" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold mb-2">Delete Item</h3>
      <p class="text-xs text-text-secondary mb-4">Delete "{itemTitle}" from the library? This removes it from the index only (the file stays on disk).</p>
      <div class="flex gap-2 justify-end">
        <button class="px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={onCancelDelete}>Cancel</button>
        <button class="px-3 py-1.5 text-xs bg-error text-white rounded hover:opacity-90 transition-colors" onclick={onConfirmDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if showKeybindings}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onclick={onCloseKeybindings} onkeydown={(e) => e.key === 'Escape' && onCloseKeybindings()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-surface-1 border border-border rounded-lg p-5 w-80 shadow-xl" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold mb-3">Keyboard Shortcuts</h3>
      <div class="space-y-1.5 text-xs">
        {#each shortcuts as [key, desc]}
          <div class="flex justify-between">
            <span class="text-text-muted font-mono">{key}</span>
            <span>{desc}</span>
          </div>
        {/each}
      </div>
      <button class="mt-4 w-full px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={onCloseKeybindings}>Close</button>
    </div>
  </div>
{/if}
