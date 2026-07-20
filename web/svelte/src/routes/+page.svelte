<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type Item, type Stats, type CategoryCount, type TagCount, type ReadingDashboard, type ReadingProgress, type ReadingSession } from '$lib/api';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Toolbar from '$lib/components/Toolbar.svelte';
  import BookCard from '$lib/components/BookCard.svelte';
  import BookRow from '$lib/components/BookRow.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import Reader from '$lib/components/Reader.svelte';
  import Modals from '$lib/components/Modals.svelte';

  let query = $state(''), activeType = $state(''), activeCategory = $state('');
  let activeTag = $state(''), activePurpose = $state(''), sortBy = $state('');
  let items = $state<Item[]>([]), total = $state(0), page = $state(1), totalPages = $state(1);
  let stats = $state<Stats | null>(null);
  let categories = $state<CategoryCount[]>([]);
  let tags = $state<TagCount[]>([]);
  let purposes = $state<TagCount[]>([]);
  let selectedItem = $state<Item | null>(null);
  let view = $state<'grid' | 'list' | 'reading'>('grid');
  let dashboard = $state<ReadingDashboard | null>(null);
  let loading = $state(false);
  let selectedProgress = $state<ReadingProgress | null>(null);
  let selectedSessions = $state<ReadingSession[]>([]);
  let activeSession = $state<{ item_id: number; session_id: number } | null>(null);
  let showDeleteModal = $state(false), showKeybindings = $state(false);
  let readingItem = $state<Item | null>(null);
  let theme = $state<'dark' | 'light'>(typeof window !== 'undefined'
    ? (localStorage.getItem('theme') as 'dark' | 'light') ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : 'dark');
  let showPreviewPanel = $state(typeof window !== 'undefined'
    ? localStorage.getItem('showPreviewPanel') !== 'false'
    : true);
  let itemsPerPage = $state(typeof window !== 'undefined'
    ? parseInt(localStorage.getItem('itemsPerPage') || '20', 10)
    : 20);
  let middleWidth = $state(typeof window !== 'undefined'
    ? parseInt(localStorage.getItem('middleWidth') || '420', 10)
    : 420);
  let isResizing = $state(false);

  async function search() {
    loading = true;
    try { const r = await api.search(query, { type: activeType || undefined, category: activeCategory || undefined,
      tag: activeTag || undefined, purpose: activePurpose || undefined, sort: sortBy || undefined, page, limit: itemsPerPage });
      items = r.items || []; total = r.total; totalPages = r.total_pages;
    } catch (e) { console.error(e); items = []; }
    loading = false;
  }
  async function loadSidebarData() { try { const [s, c, t, p] = await Promise.all([api.stats(), api.categories(), api.tags(), api.purposes()]);
    stats = s; categories = c; tags = t; purposes = p; } catch (e) { console.error(e); } }
  async function loadDashboard() { try { dashboard = await api.readingDashboard(); } catch (e) { console.error(e); } }
  async function loadProgress(item: Item) {
    try { selectedProgress = await api.readingProgress(item.id); } catch { selectedProgress = null; }
    try { selectedSessions = await api.readingSessions(item.id); } catch { selectedSessions = []; }
  }
  function selectItem(item: Item) { selectedItem = item; if (view === 'reading') view = 'grid'; loadProgress(item); }
  function handleQueryInput(e: Event) { query = (e.target as HTMLInputElement).value; page = 1; search(); }
  function handleSearch(e: Event) { e.preventDefault(); page = 1; search(); }
  function selectType(t: string) { activeType = t; activeCategory = ''; activeTag = ''; activePurpose = ''; page = 1; search(); }
  function selectCategory(c: string) { activeCategory = c; page = 1; search(); }
  function selectTag(t: string) { activeTag = t; page = 1; search(); }
  function selectPurpose(p: string) { activePurpose = p; page = 1; search(); }
  function toggleTheme() { theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }
  function togglePreviewPanel() { showPreviewPanel = !showPreviewPanel;
    localStorage.setItem('showPreviewPanel', String(showPreviewPanel)); }
  function setItemsPerPage(n: number) { itemsPerPage = n; page = 1;
    localStorage.setItem('itemsPerPage', String(n)); search(); }
  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = middleWidth;
    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(280, Math.min(startWidth + delta, window.innerWidth - 320));
      middleWidth = newWidth;
    }
    function onUp() {
      isResizing = false;
      localStorage.setItem('middleWidth', String(middleWidth));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  async function rescan() { loading = true;
    try { await api.scan(); await Promise.all([search(), loadSidebarData()]); } catch (e) { console.error(e); } loading = false; }
  async function onSaved(u: Item) { selectedItem = u; items = items.map((i) => (i.id === u.id ? u : i)); await loadSidebarData(); }
  async function deleteItem() { if (!selectedItem) return;
    try { await api.delete(selectedItem.id); selectedItem = null; showDeleteModal = false; search(); loadSidebarData(); } catch (e) { console.error(e); } }

  function handleKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const isInput = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    if (e.key === '/' && !isInput) { e.preventDefault(); document.getElementById('search-input')?.focus(); return; }
    if (e.key === 'Escape') {
      if (readingItem) readingItem = null; else if (showDeleteModal) showDeleteModal = false;
      else if (showKeybindings) showKeybindings = false; else if (selectedItem) selectedItem = null;
      else (document.activeElement as HTMLElement)?.blur(); return;
    }
    if (isInput || showDeleteModal || showKeybindings || readingItem) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { const i = items.findIndex((x) => x.id === selectedItem?.id); if (i < items.length - 1) selectItem(items[i + 1]); e.preventDefault(); }
    if (e.key === 'k' || e.key === 'ArrowUp') { const i = items.findIndex((x) => x.id === selectedItem?.id); if (i > 0) selectItem(items[i - 1]); e.preventDefault(); }
    if ((e.key === 'Enter' || e.key === 'o') && selectedItem) { api.open(selectedItem.id); e.preventDefault(); }
    if (e.key === 'r' && selectedItem) { readingItem = selectedItem; e.preventDefault(); }
    if (e.key === 'd' && selectedItem) { showDeleteModal = true; e.preventDefault(); }
    if (e.key === 'R') rescan();
    if (e.key === 'g') view = 'grid';
    if (e.key === 'l') view = 'list';
    if (e.key === 'b') { view = 'reading'; loadDashboard(); }
    if (e.key === 'p') togglePreviewPanel();
    if (e.key === '?') showKeybindings = true;
  }
  $effect(() => { document.documentElement.setAttribute('data-theme', theme); });
  onMount(() => { search(); loadSidebarData(); window.addEventListener('keydown', handleKeydown); });
  onDestroy(() => { window.removeEventListener('keydown', handleKeydown); });
</script>

<div class="flex h-screen bg-surface-0 text-text-primary">
  <!-- Left: Sidebar -->
  <div class="w-56 border-r border-border bg-surface-1 shrink-0 hidden md:block">
    <Sidebar {stats} {categories} {tags} {purposes} {activeType} {activeCategory} {activeTag} {activePurpose}
      onSelectType={selectType} onSelectCategory={selectCategory} onSelectTag={selectTag} onSelectPurpose={selectPurpose} />
  </div>

  <!-- Middle: List -->
  <div class="border-r border-border bg-surface-1 shrink-0 flex flex-col" class:flex-1={!showPreviewPanel} style={showPreviewPanel ? `width: ${middleWidth}px` : ''}>
    <Toolbar {query} {view} {theme} {loading} {showPreviewPanel}
      onQueryInput={handleQueryInput} onSearch={handleSearch}
      onViewChange={(v) => { view = v; if (v === 'reading') loadDashboard(); }}
      onToggleTheme={toggleTheme} onRescan={rescan} onShowKeybindings={() => (showKeybindings = true)}
      onTogglePreview={togglePreviewPanel} />
    <div class="px-3 py-1.5 border-b border-border flex items-center gap-2">
      <select bind:value={sortBy} onchange={() => { page = 1; search(); }} class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer">
        <option value="">Sort: Title</option><option value="year">Sort: Year</option>
        <option value="added">Sort: Recent</option><option value="size">Sort: Size</option>
      </select>
      <select bind:value={itemsPerPage} onchange={(e) => setItemsPerPage(parseInt((e.target as HTMLSelectElement).value, 10))} class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer">
        <option value={10}>10 / page</option>
        <option value={20}>20 / page</option>
        <option value={40}>40 / page</option>
        <option value={60}>60 / page</option>
        <option value={100}>100 / page</option>
      </select>
      <div class="flex-1"></div>
      <span class="text-[10px] text-text-muted">{total} items</span>
    </div>
    <div class="flex-1 overflow-y-auto">
      {#if loading && items.length === 0}
        <div class="p-4 text-center text-text-muted text-sm">Loading…</div>
      {:else if items.length === 0}
        <div class="p-4 text-center text-text-muted text-sm">No results</div>
      {:else if view === 'list'}
        {#each items as item (item.id)}
          <BookRow {item} isSelected={selectedItem?.id === item.id} {query} onClick={selectItem} />
        {/each}
      {:else}
        <div class="grid grid-cols-2 gap-2 p-2">
          {#each items as item (item.id)}
            <BookCard {item} isSelected={selectedItem?.id === item.id} {query} onClick={selectItem} />
          {/each}
        </div>
      {/if}
    </div>
    {#if totalPages > 1}
      <div class="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-text-muted">
        <span>{page}/{totalPages}</span>
        <div class="flex gap-1">
          <button class="px-2 py-0.5 rounded hover:bg-surface-3 disabled:opacity-30" disabled={page <= 1} onclick={() => { page--; search(); }}>Prev</button>
          <button class="px-2 py-0.5 rounded hover:bg-surface-3 disabled:opacity-30" disabled={page >= totalPages} onclick={() => { page++; search(); }}>Next</button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Resize handle -->
  {#if showPreviewPanel}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="w-1 hover:w-1.5 bg-border hover:bg-accent cursor-col-resize shrink-0 transition-all" class:animate-pulse={isResizing} onmousedown={startResize}></div>
  {/if}

  <!-- Right: Detail / Reading dashboard -->
  {#if showPreviewPanel || (view === 'reading' && dashboard)}
    <div class="flex-1 overflow-hidden bg-surface-0">
      {#if view === 'reading' && dashboard}
        <div class="p-6 max-w-4xl overflow-y-auto h-full">
          <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" class="text-accent">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
            Reading Dashboard
          </h2>
          <div class="grid grid-cols-4 gap-3 mb-6">
            <div class="bg-surface-1 border border-border rounded-lg p-3"><div class="text-2xl font-bold text-accent">{dashboard.total_read_books}</div><div class="text-[10px] text-text-muted uppercase">Finished</div></div>
            <div class="bg-surface-1 border border-border rounded-lg p-3"><div class="text-2xl font-bold text-success">{dashboard.currently_reading.length}</div><div class="text-[10px] text-text-muted uppercase">Reading now</div></div>
            <div class="bg-surface-1 border border-border rounded-lg p-3"><div class="text-2xl font-bold">{dashboard.today_reading_minutes}m</div><div class="text-[10px] text-text-muted uppercase">Today</div></div>
            <div class="bg-surface-1 border border-border rounded-lg p-3"><div class="text-2xl font-bold">{dashboard.week_reading_minutes}m</div><div class="text-[10px] text-text-muted uppercase">This week</div></div>
          </div>
          {#if dashboard.currently_reading.length > 0}
            <h3 class="text-sm font-semibold mb-2">Currently Reading</h3>
            <div class="space-y-2 mb-6">
              {#each dashboard.currently_reading as cr}
                <button class="w-full text-left bg-surface-1 border border-border rounded-lg p-3 hover:border-accent/50 transition-colors" onclick={() => { view = 'grid'; selectItem(cr.item); }}>
                  <div class="flex items-center justify-between mb-1"><span class="text-sm font-medium truncate">{cr.item.title}</span><span class="text-xs text-text-muted">{cr.progress.progress_percent}%</span></div>
                  <div class="h-1 bg-surface-3 rounded-full overflow-hidden"><div class="h-full bg-accent" style="width: {cr.progress.progress_percent}%"></div></div>
                </button>
              {/each}
            </div>
          {/if}
          {#if dashboard.queue.length > 0}
            <h3 class="text-sm font-semibold mb-2">Reading Queue</h3>
            <div class="space-y-1">
              {#each dashboard.queue as q}
                <div class="flex items-center gap-2 text-sm bg-surface-1 border border-border rounded px-3 py-2">
                  <span class="text-text-muted text-xs">#{q.priority}</span><span class="truncate flex-1">{q.title}</span><span class="text-xs text-text-muted">{q.author}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <DetailPanel item={selectedItem} progress={selectedProgress} sessions={selectedSessions} {activeSession}
          onOpen={(item) => api.open(item.id)}
          onDelete={(item) => { selectedItem = item; showDeleteModal = true; }}
          onRead={(item) => (readingItem = item)}
          onSaved={onSaved}
          onProgressChanged={() => selectedItem && loadProgress(selectedItem)}
          onSessionChanged={() => selectedItem && loadProgress(selectedItem)} />
      {/if}
    </div>
  {/if}
</div>

{#if readingItem}
  <Reader item={readingItem} onClose={() => (readingItem = null)} />
{/if}

<Modals showDelete={showDeleteModal} showKeybindings={showKeybindings} itemTitle={selectedItem?.title || ''}
  onConfirmDelete={deleteItem} onCancelDelete={() => (showDeleteModal = false)} onCloseKeybindings={() => (showKeybindings = false)} />
