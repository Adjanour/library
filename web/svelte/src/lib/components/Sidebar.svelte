<script lang="ts">
  import type { Stats, CategoryCount, TagCount } from '$lib/api';

  let {
    stats,
    categories,
    tags,
    purposes,
    activeType,
    activeCategory,
    activeTag,
    activePurpose,
    onSelectType,
    onSelectCategory,
    onSelectTag,
    onSelectPurpose
  }: {
    stats: Stats | null;
    categories: CategoryCount[];
    tags: TagCount[];
    purposes: TagCount[];
    activeType: string;
    activeCategory: string;
    activeTag: string;
    activePurpose: string;
    onSelectType: (t: string) => void;
    onSelectCategory: (c: string) => void;
    onSelectTag: (t: string) => void;
    onSelectPurpose: (p: string) => void;
  } = $props();

  const typeLabels: Record<string, string> = {
    book: 'Books', paper: 'Papers', thesis: 'Theses', ebook: 'Ebooks', other: 'Other'
  };
</script>

<div class="flex flex-col h-full overflow-y-auto">
  <!-- Total count -->
  <div class="px-3 py-3 border-b border-border">
    <div class="text-2xl font-bold text-text-primary">{stats?.total_items ?? 0}</div>
    <div class="text-[10px] text-text-muted uppercase tracking-wider">Items in library</div>
  </div>

  <!-- Types -->
  {#if stats}
    <div class="px-3 py-2">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Type</div>
      <button
        class="w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between hover:bg-surface-2 transition-colors"
        class:bg-accent={!activeType} class:text-white={!activeType}
        onclick={() => onSelectType('')}
      >
        <span>All</span>
        <span class="text-[10px] opacity-70">{stats.total_items}</span>
      </button>
      {#each Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]) as [type, count]}
        <button
          class="w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between hover:bg-surface-2 transition-colors"
          class:bg-accent={activeType === type} class:text-white={activeType === type}
          onclick={() => onSelectType(type)}
        >
          <span>{typeLabels[type] ?? type}</span>
          <span class="text-[10px] opacity-70">{count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Purposes -->
  {#if purposes.length > 0}
    <div class="px-3 py-2 border-t border-border">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Purpose</div>
      <button
        class="w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between hover:bg-surface-2 transition-colors"
        class:bg-accent={!activePurpose} class:text-white={!activePurpose}
        onclick={() => onSelectPurpose('')}
      >
        <span>All</span>
      </button>
      {#each purposes as p}
        <button
          class="w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between hover:bg-surface-2 transition-colors"
          class:bg-accent={activePurpose === p.name} class:text-white={activePurpose === p.name}
          onclick={() => onSelectPurpose(p.name)}
        >
          <span class="truncate">{p.name}</span>
          <span class="text-[10px] opacity-70 shrink-0 ml-1">{p.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Categories -->
  {#if categories.length > 0}
    <div class="px-3 py-2 border-t border-border">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Category</div>
      {#each categories as cat}
        <button
          class="w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between hover:bg-surface-2 transition-colors"
          class:bg-accent={activeCategory === cat.name} class:text-white={activeCategory === cat.name}
          onclick={() => onSelectCategory(activeCategory === cat.name ? '' : cat.name)}
        >
          <span class="truncate">{cat.name}</span>
          <span class="text-[10px] opacity-70 shrink-0 ml-1">{cat.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Tags -->
  {#if tags.length > 0}
    <div class="px-3 py-2 border-t border-border">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Tags</div>
      <div class="flex flex-wrap gap-1">
        {#each tags.slice(0, 30) as tag}
          <button
            class="text-[10px] px-1.5 py-0.5 rounded transition-colors"
            class:bg-accent={activeTag === tag.name} class:text-white={activeTag === tag.name}
            class:bg-surface-2={activeTag !== tag.name} class:hover:bg-surface-3={activeTag !== tag.name}
            onclick={() => onSelectTag(activeTag === tag.name ? '' : tag.name)}
          >
            {tag.name} <span class="opacity-50">{tag.count}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
