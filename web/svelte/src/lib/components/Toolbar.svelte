<script lang="ts">
  import { TYPES, SORTS } from '$lib/utils';

  let {
    query,
    view,
    theme,
    loading,
    onQueryInput,
    onSearch,
    onViewChange,
    onToggleTheme,
    onRescan,
    onShowKeybindings
  }: {
    query: string;
    view: 'grid' | 'list' | 'reading';
    theme: 'dark' | 'light';
    loading: boolean;
    onQueryInput: (e: Event) => void;
    onSearch: (e: Event) => void;
    onViewChange: (v: 'grid' | 'list' | 'reading') => void;
    onToggleTheme: () => void;
    onRescan: () => void;
    onShowKeybindings: () => void;
  } = $props();
</script>

<div class="border-b border-border px-3 py-2 space-y-2">
  <div class="flex items-center gap-2">
    <div class="text-sm font-semibold text-accent flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
      </svg>
      Library
    </div>

    <div class="flex-1" />

    <!-- View toggles -->
    <div class="flex items-center gap-0.5">
      <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'grid'} class:text-white={view === 'grid'} title="Grid (g)" onclick={() => onViewChange('grid')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>
      <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'list'} class:text-white={view === 'list'} title="List (l)" onclick={() => onViewChange('list')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'reading'} class:text-white={view === 'reading'} title="Reading (b)" onclick={() => onViewChange('reading')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
      </button>
    </div>

    <div class="w-px h-5 bg-border" />

    <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" title="Rescan (R)" onclick={onRescan}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" class={loading ? 'animate-spin' : ''}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    </button>
    <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" title="Toggle theme" onclick={onToggleTheme}>
      {#if theme === 'dark'}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      {/if}
    </button>
    <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" title="Shortcuts (?)" onclick={onShowKeybindings}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </button>
  </div>

  <form onsubmit={onSearch} class="flex gap-1.5">
    <input
      id="search-input"
      type="text"
      value={query}
      oninput={onQueryInput}
      placeholder="Search title, author, purpose… (/)"
      class="flex-1 bg-surface-2 border border-border rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
    />
  </form>
</div>
