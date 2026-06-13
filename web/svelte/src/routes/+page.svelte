<script lang="ts">
  import { api, type Item, type Stats, type ReadingDashboard, type ReadingProgress, type ReadingSession } from '$lib/api';

  let query = $state('');
  let typeFilter = $state('');
  let categoryFilter = $state('');
  let sortBy = $state('');
  let items = $state<Item[]>([]);
  let total = $state(0);
  let page = $state(1);
  let totalPages = $state(1);
  let stats = $state<Stats | null>(null);
  let categories = $state<string[]>([]);
  let selectedItem = $state<Item | null>(null);
  let view = $state<'grid' | 'list' | 'reading'>('grid');
  let dashboard = $state<ReadingDashboard | null>(null);
  let loading = $state(false);
  let selectedProgress = $state<ReadingProgress | null>(null);
  let selectedSessions = $state<ReadingSession[]>([]);
  let activeSession = $state<{ item_id: number; session_id: number } | null>(null);
  let showDeleteModal = $state(false);
  let showKeybindings = $state(false);
  let progressInput = $state({ percent: 0, page: 0, pages: 0 });
  let previewUrl = $state('');
  let panelWidth = $state(40);
  let readestStatus = $state<{ enabled: boolean; total_books: number; currently_reading: number } | null>(null);
  let syncResult = $state<{ success: boolean; message: string; matched_books: number; updated_progress: number } | null>(null);

  // Theme
  let theme = $state<'dark' | 'light'>(
    typeof window !== 'undefined'
      ? (localStorage.getItem('theme') as 'dark' | 'light') ||
        (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : 'dark'
  );

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  async function search() {
    loading = true;
    try {
      const result = await api.search(query, {
        type: typeFilter || undefined,
        category: categoryFilter || undefined,
        sort: sortBy || undefined,
        page
      });
      items = result.items || [];
      total = result.total;
      totalPages = result.total_pages;
    } catch (e) {
      console.error(e);
      items = [];
    }
    loading = false;
  }

  async function loadStats() {
    try {
      stats = await api.stats();
      categories = await api.categories();
    } catch (e) { console.error(e); }
  }

  async function loadDashboard() {
    try {
      dashboard = await api.readingDashboard();
    } catch (e) { console.error(e); }
    try {
      readestStatus = await api.readestStatus();
    } catch { readestStatus = null; }
  }

  async function syncReadest() {
    try {
      syncResult = await api.syncReadest();
      await loadDashboard();
    } catch (e) { console.error(e); }
  }

  async function loadProgress(item: Item) {
    try {
      selectedProgress = await api.readingProgress(item.id);
      if (selectedProgress) {
        progressInput = {
          percent: selectedProgress.progress_percent,
          page: selectedProgress.current_page,
          pages: selectedProgress.total_pages
        };
      } else {
        progressInput = { percent: 0, page: 0, pages: 0 };
      }
    } catch {
      selectedProgress = null;
      progressInput = { percent: 0, page: 0, pages: 0 };
    }
    try {
      selectedSessions = await api.readingSessions(item.id);
    } catch { selectedSessions = []; }
  }

  function loadPreview(item: Item) {
    const ext = item.filename.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      previewUrl = `/api/file/${item.id}`;
    } else if (['epub', 'mobi', 'azw3', 'fb2'].includes(ext)) {
      previewUrl = '';
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      previewUrl = `/api/file/${item.id}`;
    } else {
      previewUrl = '';
    }
  }

  function handleSearch(e: Event) {
    e.preventDefault();
    page = 1;
    search();
  }

  function selectItem(item: Item) {
    selectedItem = item;
    view = 'grid';
    loadProgress(item);
    loadPreview(item);
  }

  async function startReadingSession() {
    if (!selectedItem) return;
    try {
      const session = await api.startReading(selectedItem.id);
      activeSession = { item_id: selectedItem.id, session_id: session.id };
      await loadProgress(selectedItem);
    } catch (e) { console.error(e); }
  }

  async function stopReadingSession(pagesRead: number = 0) {
    if (!selectedItem) return;
    try {
      await api.stopReading(selectedItem.id, pagesRead);
      activeSession = null;
      await loadProgress(selectedItem);
    } catch (e) { console.error(e); }
  }

  async function updateProgress() {
    if (!selectedItem) return;
    try {
      await api.updateProgress(selectedItem.id, {
        progress_percent: progressInput.percent,
        current_page: progressInput.page,
        total_pages: progressInput.pages
      });
      await loadProgress(selectedItem);
    } catch (e) { console.error(e); }
  }

  async function finishBook() {
    if (!selectedItem) return;
    try {
      await api.finishReading(selectedItem.id);
      selectedProgress = null;
      activeSession = null;
      progressInput = { percent: 0, page: 0, pages: 0 };
      await loadDashboard();
    } catch (e) { console.error(e); }
  }

  async function deleteItem() {
    if (!selectedItem) return;
    try {
      await api.delete(selectedItem.id);
      selectedItem = null;
      showDeleteModal = false;
      search();
    } catch (e) { console.error(e); }
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    if (e.key === '/' && !isInput) { e.preventDefault(); document.getElementById('search-input')?.focus(); }
    if (e.key === 'Escape') {
      if (showDeleteModal) showDeleteModal = false;
      else if (showKeybindings) showKeybindings = false;
      else if (selectedItem) { selectedItem = null; previewUrl = ''; }
      else (document.activeElement as HTMLElement)?.blur();
    }
    if (!isInput && !showDeleteModal && !showKeybindings) {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        const idx = items.findIndex(i => i.id === selectedItem?.id);
        if (idx < items.length - 1) selectItem(items[idx + 1]);
        e.preventDefault();
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        const idx = items.findIndex(i => i.id === selectedItem?.id);
        if (idx > 0) selectItem(items[idx - 1]);
        e.preventDefault();
      }
      if (e.key === 'Enter' && selectedItem) api.open(selectedItem.id);
      if (e.key === 'o' && selectedItem) api.open(selectedItem.id);
      if (e.key === 'd' && selectedItem) showDeleteModal = true;
      if (e.key === 'r') { search(); if (view === 'reading') loadDashboard(); }
      if (e.key === '?') showKeybindings = !showKeybindings;
      if (e.key === 'g') view = 'grid';
      if (e.key === 'l') view = 'list';
      if (e.key === 'b') { view = 'reading'; loadDashboard(); }
    }
  }

  function highlight(text: string, q: string): string {
    if (!q || q.length < 2) return esc(text);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-accent/30 text-text-primary rounded px-0.5">$1</mark>');
  }

  function esc(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function sz(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  function timeAgo(dateStr: string): string {
    if (!dateStr) return 'never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function typeIcon(t: string): string {
    const icons: Record<string, string> = {
      book: 'M12 7h.01M15 11h.01M8 11h.01M18 11h.01M7 7h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z',
      paper: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
      thesis: 'M22 10v6M2 10l10-5 10 5-10 5z M6 12v5c3 3 9 3 12 0v-5',
      ebook: 'M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
      other: 'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z M13 2v7h7'
    };
    return icons[t] || icons.other;
  }

  function fileExt(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  $effect(() => {
    loadStats();
    search();

    // Listen for system theme changes
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        theme = e.matches ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-screen overflow-hidden select-none">
  <!-- Left Panel -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex flex-col border-r border-border bg-surface-1 shrink-0"
    style="width: {panelWidth}%"
    onmousedown={(e) => {
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        panelWidth = Math.min(70, Math.max(20, startW + (delta / window.innerWidth) * 100));
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }}
  >
    <!-- Header -->
    <div class="p-3 border-b border-border">
      <div class="flex items-center gap-2 mb-2">
        <h1 class="text-sm font-semibold flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" class="text-accent">
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
          </svg>
          Library
          {#if stats}
            <span class="text-text-muted text-xs font-normal">{stats.total_items} items</span>
          {/if}
        </h1>
        <div class="ml-auto flex gap-1">
          <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'grid'} class:text-white={view === 'grid'} title="Grid (g)" onclick={() => view = 'grid'}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'list'} class:text-white={view === 'list'} title="List (l)" onclick={() => view = 'list'}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" class:bg-accent={view === 'reading'} class:text-white={view === 'reading'} title="Reading (b)" onclick={() => { view = 'reading'; loadDashboard(); }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
          </button>
          <div class="w-px h-5 bg-border mx-0.5"></div>
          <button class="p-1.5 rounded hover:bg-surface-3 transition-colors" title="Toggle theme" onclick={toggleTheme}>
            {#if theme === 'dark'}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            {/if}
          </button>
        </div>
      </div>

      <form onsubmit={handleSearch} class="flex gap-1.5">
        <input id="search-input" type="text" bind:value={query} placeholder="Search... (/)" class="flex-1 bg-surface-2 border border-border rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
      </form>

      <div class="flex gap-1.5 mt-2">
        <select bind:value={typeFilter} onchange={() => { page = 1; search(); }} class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer">
          <option value="">All Types</option>
          <option value="book">Books</option>
          <option value="paper">Papers</option>
          <option value="thesis">Theses</option>
          <option value="ebook">Ebooks</option>
        </select>
        <select bind:value={categoryFilter} onchange={() => { page = 1; search(); }} class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer">
          <option value="">All Categories</option>
          {#each categories as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
        <select bind:value={sortBy} onchange={() => { page = 1; search(); }} class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer">
          <option value="">Sort: Title</option>
          <option value="year">Sort: Year</option>
          <option value="added">Sort: Recent</option>
          <option value="size">Sort: Size</option>
        </select>
      </div>
    </div>

    <!-- Items -->
    <div class="flex-1 overflow-y-auto">
      {#if loading}
        <div class="p-4 text-center text-text-muted text-sm">Loading...</div>
      {:else if items.length === 0}
        <div class="p-4 text-center text-text-muted text-sm">No results</div>
      {:else if view === 'list'}
        {#each items as item (item.id)}
          <button class="w-full text-left px-3 py-2 border-b border-border hover:bg-surface-2 transition-colors flex items-center gap-2" class:bg-surface-2={selectedItem?.id === item.id} onclick={() => selectItem(item)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 text-text-muted"><path d={typeIcon(item.type)}/></svg>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate">{@html highlight(item.title, query)}</div>
              <div class="text-xs text-text-muted truncate">{item.authors || 'Unknown'} {item.year ? `(${item.year})` : ''}</div>
            </div>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary shrink-0">{item.type}</span>
          </button>
        {/each}
      {:else}
        <div class="grid grid-cols-3 gap-2 p-2">
          {#each items as item (item.id)}
            <button class="text-left p-2.5 rounded-lg border border-border hover:border-accent/50 hover:bg-surface-2 transition-all" class:border-accent={selectedItem?.id === item.id} class:bg-surface-2={selectedItem?.id === item.id} onclick={() => selectItem(item)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-1 text-accent/70"><path d={typeIcon(item.type)}/></svg>
              <div class="text-xs font-medium truncate leading-tight">{@html highlight(item.title, query)}</div>
              <div class="text-[10px] text-text-muted truncate mt-0.5">{item.authors || 'Unknown'}</div>
              <div class="flex items-center gap-1 mt-1">
                <span class="text-[9px] px-1 py-0.5 rounded bg-surface-3 text-text-secondary">{item.type}</span>
                {#if item.year}<span class="text-[9px] text-text-muted">{item.year}</span>{/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
      <div class="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-text-muted">
        <span>{total} items</span>
        <div class="flex gap-1">
          <button class="px-2 py-0.5 rounded hover:bg-surface-3 disabled:opacity-30" disabled={page <= 1} onclick={() => { page--; search(); }}>Prev</button>
          <span class="px-2">{page}/{totalPages}</span>
          <button class="px-2 py-0.5 rounded hover:bg-surface-3 disabled:opacity-30" disabled={page >= totalPages} onclick={() => { page++; search(); }}>Next</button>
        </div>
      </div>
    {/if}

    <!-- Resize handle -->
    <div class="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10"></div>
  </div>

  <!-- Right Panel -->
  <div class="flex-1 overflow-y-auto bg-surface-0">
    {#if view === 'reading' && dashboard}
      <div class="p-6 max-w-4xl">
        <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" class="text-accent">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
          </svg>
          Reading Dashboard
        </h2>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div class="p-3 rounded-lg bg-surface-1 border border-border">
            <div class="text-2xl font-bold text-accent">{dashboard.total_read_books}</div>
            <div class="text-xs text-text-muted">Books Read</div>
          </div>
          <div class="p-3 rounded-lg bg-surface-1 border border-border">
            <div class="text-2xl font-bold">{Math.floor(dashboard.total_reading_minutes / 60)}h</div>
            <div class="text-xs text-text-muted">Total Reading</div>
          </div>
          <div class="p-3 rounded-lg bg-surface-1 border border-border">
            <div class="text-2xl font-bold">{dashboard.today_reading_minutes}m</div>
            <div class="text-xs text-text-muted">Today</div>
          </div>
          <div class="p-3 rounded-lg bg-surface-1 border border-border">
            <div class="text-2xl font-bold">{Math.floor(dashboard.week_reading_minutes / 60)}h {dashboard.week_reading_minutes % 60}m</div>
            <div class="text-xs text-text-muted">This Week</div>
          </div>
        </div>

        {#if dashboard.currently_reading.length > 0}
          <div class="mb-6">
            <h3 class="text-sm font-medium text-text-secondary mb-2">Currently Reading</h3>
            <div class="space-y-2">
              {#each dashboard.currently_reading as { item, progress }}
                <button class="w-full text-left p-3 rounded-lg border border-border hover:border-accent/50 bg-surface-1" onclick={() => selectItem(item)}>
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="text-sm font-medium">{item.title}</div>
                      <div class="text-xs text-text-muted">{item.authors || 'Unknown'}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-lg font-bold text-accent">{progress.progress_percent}%</div>
                      {#if progress.last_read_at}<div class="text-[10px] text-text-muted">Last: {timeAgo(progress.last_read_at)}</div>{/if}
                    </div>
                  </div>
                  <div class="mt-2 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div class="h-full bg-accent rounded-full transition-all" style="width: {progress.progress_percent}%"></div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if dashboard.queue.length > 0}
          <div class="mb-6">
            <h3 class="text-sm font-medium text-text-secondary mb-2">Reading Queue</h3>
            <div class="space-y-1">
              {#each dashboard.queue as book, i}
                <div class="flex items-center gap-3 p-2 rounded hover:bg-surface-1 group" class:cursor-pointer={book.item_id}>
                  <span class="text-xs text-text-muted w-4 text-right">{i + 1}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">{book.title}</div>
                    <div class="text-xs text-text-muted">{book.author || 'FocusD Plan'}</div>
                  </div>
                  {#if book.item_id}
                    <button class="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[10px] bg-accent/10 text-accent border border-accent/30 rounded hover:bg-accent/20 transition-all" onclick={() => api.open(book.item_id!)}>
                      Open {book.file_type || ''}
                    </button>
                  {:else}
                    <span class="text-[10px] text-text-muted">not in library</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <button class="px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={async () => { await api.syncFocusd(); loadDashboard(); }}>
          Sync from FocusD
        </button>

        {#if readestStatus?.enabled}
          <div class="mt-4 p-3 rounded-lg bg-surface-1 border border-border">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-text-secondary">Readest</span>
              <span class="text-[10px] text-text-muted">{readestStatus.currently_reading} in progress</span>
            </div>
            <button class="w-full px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/30 rounded hover:bg-accent/20 transition-colors" onclick={syncReadest}>
              Sync from Readest
            </button>
            {#if syncResult}
              <div class="mt-2 text-[10px]" class:text-green-400={syncResult.success} class:text-red-400={!syncResult.success}>
                {syncResult.message} ({syncResult.updated_progress} updated)
              </div>
            {/if}
          </div>
        {/if}
      </div>

    {:else if selectedItem}
      <div class="flex flex-col lg:flex-row h-full">
        <!-- Detail panel -->
        <div class="p-6 lg:w-1/2 overflow-y-auto">
          <button class="lg:hidden mb-4 text-xs text-accent flex items-center gap-1" onclick={() => { selectedItem = null; previewUrl = ''; }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>

          <div class="flex items-start gap-3 mb-4">
            <div class="p-2.5 rounded-lg bg-surface-1 border border-border">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-accent">
                <path d={typeIcon(selectedItem.type)}/>
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold leading-tight">{selectedItem.title}</h2>
              <div class="text-sm text-text-secondary mt-0.5">{selectedItem.authors || 'Unknown author'}</div>
            </div>
            <button class="text-text-muted hover:text-text-primary hidden lg:block" title="Close (Esc)" onclick={() => { selectedItem = null; previewUrl = ''; }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="p-2.5 rounded bg-surface-1 border border-border">
              <div class="text-xs text-text-muted">Type</div>
              <div class="text-sm capitalize">{selectedItem.type}</div>
            </div>
            <div class="p-2.5 rounded bg-surface-1 border border-border">
              <div class="text-xs text-text-muted">Year</div>
              <div class="text-sm">{selectedItem.year || '—'}</div>
            </div>
            <div class="p-2.5 rounded bg-surface-1 border border-border">
              <div class="text-xs text-text-muted">Category</div>
              <div class="text-sm">{selectedItem.category || '—'}</div>
            </div>
            <div class="p-2.5 rounded bg-surface-1 border border-border">
              <div class="text-xs text-text-muted">Size</div>
              <div class="text-sm">{sz(selectedItem.size)}</div>
            </div>
          </div>

          {#if selectedItem.tags}
            <div class="mb-4">
              <div class="text-xs text-text-muted mb-1">Tags</div>
              <div class="flex flex-wrap gap-1">
                {#each selectedItem.tags.split(',').filter(Boolean) as tag}
                  <span class="text-xs px-2 py-0.5 rounded bg-surface-2 text-text-secondary">{tag.trim()}</span>
                {/each}
              </div>
            </div>
          {/if}

          {#if selectedItem.description}
            <div class="mb-4">
              <div class="text-xs text-text-muted mb-1">Description</div>
              <p class="text-sm text-text-secondary leading-relaxed">{selectedItem.description}</p>
            </div>
          {/if}

          <div class="text-xs text-text-muted mb-4">File: {selectedItem.filename}</div>

          <!-- Reading Progress -->
          <div class="mb-4 p-3 rounded-lg bg-surface-1 border border-border">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium">Reading Progress</h3>
              {#if activeSession?.item_id === selectedItem.id}
                <span class="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent">Reading</span>
              {/if}
            </div>

            {#if selectedProgress}
              <div class="mb-3">
                <div class="flex items-center justify-between text-xs text-text-muted mb-1">
                  <span>{selectedProgress.progress_percent}% complete</span>
                  {#if selectedProgress.current_page && selectedProgress.total_pages}
                    <span>{selectedProgress.current_page} / {selectedProgress.total_pages} pages</span>
                  {/if}
                </div>
                <div class="h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div class="h-full bg-accent rounded-full transition-all" style="width: {selectedProgress.progress_percent}%"></div>
                </div>
                {#if selectedProgress.started_at}
                  <div class="flex gap-4 mt-1.5 text-[10px] text-text-muted">
                    <span>Started: {new Date(selectedProgress.started_at).toLocaleDateString()}</span>
                    {#if selectedProgress.last_read_at}<span>Last: {timeAgo(selectedProgress.last_read_at)}</span>{/if}
                  </div>
                {/if}
              </div>
            {/if}

            <div class="grid grid-cols-3 gap-2 mb-3">
              <div>
                <label class="text-[10px] text-text-muted">Percent</label>
                <input type="number" min="0" max="100" bind:value={progressInput.percent} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label class="text-[10px] text-text-muted">Page</label>
                <input type="number" min="0" bind:value={progressInput.page} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label class="text-[10px] text-text-muted">Total</label>
                <input type="number" min="0" bind:value={progressInput.pages} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
              </div>
            </div>

            <div class="flex gap-2 flex-wrap">
              {#if activeSession?.item_id === selectedItem.id}
                <button class="px-2.5 py-1 text-xs bg-warning/20 text-warning rounded hover:bg-warning/30 transition-colors" onclick={() => stopReadingSession(progressInput.page)}>Stop Reading</button>
              {:else}
                <button class="px-2.5 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors" onclick={startReadingSession}>Start Reading</button>
              {/if}
              <button class="px-2.5 py-1 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={updateProgress}>Update</button>
              <button class="px-2.5 py-1 text-xs bg-success/20 text-success rounded hover:bg-success/30 transition-colors" onclick={finishBook}>Mark Finished</button>
            </div>

            {#if selectedSessions.length > 0}
              <div class="mt-3 border-t border-border pt-2">
                <div class="text-[10px] text-text-muted mb-1">Recent Sessions</div>
                {#each selectedSessions.slice(0, 3) as s}
                  <div class="text-[10px] text-text-secondary">
                    {new Date(s.started_at).toLocaleDateString()} — {Math.floor((s.duration_seconds || 0) / 60)}m
                    {#if s.pages_read}· {s.pages_read} pages{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors flex items-center gap-1.5" onclick={() => api.open(selectedItem!.id)}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open (o)
            </button>
            <button class="px-3 py-1.5 text-sm bg-error/20 text-error rounded hover:bg-error/30 transition-colors" onclick={() => showDeleteModal = true}>Delete (d)</button>
          </div>
        </div>

        <!-- Preview panel -->
        <div class="lg:w-1/2 border-t lg:border-t-0 lg:border-l border-border bg-surface-1 overflow-hidden flex items-center justify-center">
          {#if previewUrl}
            {#if fileExt(selectedItem.filename) === 'pdf'}
              <iframe src={previewUrl} class="w-full h-full min-h-[600px]" title="PDF preview"></iframe>
            {:else if ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt(selectedItem.filename))}
              <img src={previewUrl} alt={selectedItem.title} class="max-w-full max-h-[80vh] object-contain p-4" />
            {:else}
              <div class="p-8 text-center text-text-muted">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="mx-auto mb-3 opacity-30">
                  <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/>
                </svg>
                <div class="text-sm">Preview not available</div>
                <div class="text-xs mt-1">Click Open to view in {fileExt(selectedItem.filename) === 'pdf' ? 'sioyek' : 'readest'}</div>
              </div>
            {/if}
          {:else}
            <div class="p-8 text-center text-text-muted">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="mx-auto mb-3 opacity-30">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/>
              </svg>
              <div class="text-sm">No preview</div>
              <div class="text-xs mt-1">Click Open to view in {fileExt(selectedItem.filename) === 'pdf' ? 'sioyek' : 'readest'}</div>
            </div>
          {/if}
        </div>
      </div>

    {:else}
      <div class="flex flex-col items-center justify-center h-full text-text-muted">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="mb-4 opacity-30">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
        </svg>
        <div class="text-sm">Select an item or switch to Reading view</div>
        <div class="text-xs mt-1 text-text-muted">Press ? for keyboard shortcuts</div>
      </div>
    {/if}
  </div>
</div>

<!-- Delete Modal -->
{#if showDeleteModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onclick={() => showDeleteModal = false} onkeydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-surface-1 border border-border rounded-lg p-5 w-80 shadow-xl" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold mb-2">Delete Item</h3>
      <p class="text-xs text-text-secondary mb-4">Delete "{selectedItem?.title}" from the library? This cannot be undone.</p>
      <div class="flex gap-2 justify-end">
        <button class="px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={() => showDeleteModal = false}>Cancel</button>
        <button class="px-3 py-1.5 text-xs bg-error text-white rounded hover:opacity-90 transition-colors" onclick={deleteItem}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<!-- Keybindings Modal -->
{#if showKeybindings}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onclick={() => showKeybindings = false} onkeydown={(e) => e.key === 'Escape' && (showKeybindings = false)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-surface-1 border border-border rounded-lg p-5 w-80 shadow-xl" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold mb-3">Keyboard Shortcuts</h3>
      <div class="space-y-1.5 text-xs">
        <div class="flex justify-between"><span class="text-text-muted">/</span><span>Focus search</span></div>
        <div class="flex justify-between"><span class="text-text-muted">j / k</span><span>Navigate list</span></div>
        <div class="flex justify-between"><span class="text-text-muted">Enter / o</span><span>Open in reader</span></div>
        <div class="flex justify-between"><span class="text-text-muted">d</span><span>Delete item</span></div>
        <div class="flex justify-between"><span class="text-text-muted">r</span><span>Refresh</span></div>
        <div class="flex justify-between"><span class="text-text-muted">g / l</span><span>Grid / List view</span></div>
        <div class="flex justify-between"><span class="text-text-muted">b</span><span>Reading dashboard</span></div>
        <div class="flex justify-between"><span class="text-text-muted">?</span><span>Toggle this help</span></div>
        <div class="flex justify-between"><span class="text-text-muted">Esc</span><span>Close / Back</span></div>
      </div>
      <button class="mt-4 w-full px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={() => showKeybindings = false}>Close</button>
    </div>
  </div>
{/if}
