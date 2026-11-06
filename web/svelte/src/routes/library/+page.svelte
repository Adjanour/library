<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import BookCard from '$lib/components/BookCard.svelte';
  import LibraryTable from '$lib/components/LibraryTable.svelte';
  import SelectMenu from '$lib/components/SelectMenu.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { api, type AppSettings, type CategoryCount, type Collection, type ContentSearchResult, type Item, type ReadingDashboard, type ReadingProgress, type ReadingSession, type SearchFacets, type TagCount } from '$lib/api';
  import { toast } from '$lib/toast.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import Toggle from '$lib/components/Toggle.svelte';

  let query = $state('');
  let type = $state('');
  let category = $state('');
  let tag = $state('');
  let purpose = $state('');
  let items = $state<Item[]>([]);
  let facets = $state<SearchFacets | null>(null);
  let categories = $state<CategoryCount[]>([]);
  let tags = $state<TagCount[]>([]);
  let purposes = $state<TagCount[]>([]);
  let collections = $state<Collection[]>([]);
  let selected = $state<Item | null>(null);
  let progress = $state<ReadingProgress | null>(null);
  let sessions = $state<ReadingSession[]>([]);
  let dashboard = $state<ReadingDashboard | null>(null);
  let total = $state(0);
  let page = $state(1);
  let totalPages = $state(1);
  // Default the page size to the saved setting; settled once settings load.
  let pageSize = $state(24);
  let loading = $state(true);
  let error = $state('');
  let previewOpen = $state(true);
  let view = $state<'covers' | 'table'>('covers');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let cardsEl = $state<HTMLElement | null>(null);
  let insideMatches = $state<ContentSearchResult[]>([]);
  let bulkMode = $state(false);
  let bulkSelected = $state<Set<number>>(new Set());
  let bulkCategory = $state('');
  let bulkTags = $state('');
  let bulkPurpose = $state('');
  let bulkCollectionId = $state('');
  let bulkSaving = $state(false);

  async function load(nextPage = page) {
    loading = true;
    error = '';
    try {
      const [result, content] = await Promise.all([
        api.search(query, { type: type || undefined, category: category || undefined, tag: tag || undefined, purpose: purpose || undefined, page: nextPage, limit: pageSize }),
        query.trim().length >= 2 ? api.searchContent(query, 6).catch(() => []) : Promise.resolve([])
      ]);
      items = result.items ?? [];
      insideMatches = content;
      facets = result.facets ?? null;
      total = result.total;
      page = result.page || nextPage;
      totalPages = Math.max(1, result.total_pages || Math.ceil(result.total / pageSize));    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load the library.'; }
    finally { loading = false; }
  }

  async function loadFilters() {
    try { [categories, tags, purposes, dashboard, collections] = await Promise.all([api.categories(), api.tags(), api.purposes(), api.readingDashboard(), api.collections()]); }
    catch { /* the catalog remains usable if secondary facets are unavailable */ }
  }

  async function select(item: Item) {
    selected = item;
    try { progress = await api.readingProgress(item.id); } catch { progress = null; }
    try { sessions = await api.readingSessions(item.id); } catch { sessions = []; }
  }

  function filterChanged() { page = 1; void load(1); }
  function queryChanged(next: string) {
    query = next;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; void load(1); }, 180);
  }
  function clearFilters() { query = ''; type = ''; category = ''; tag = ''; purpose = ''; page = 1; void load(1); }
  function toggleBulk(item: Item) {
    const next = new Set(bulkSelected);
    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
    bulkSelected = next;
  }
  function exitBulkMode() { bulkMode = false; bulkSelected = new Set(); }
  function selectVisible() { bulkSelected = new Set(items.map((item) => item.id)); }
  async function applyBulk() {
    if (!bulkSelected.size) return;
    const updates: Record<string, string> = {};
    if (bulkCategory.trim()) updates.category = bulkCategory.trim();
    if (bulkTags.trim()) updates.tags = bulkTags.trim();
    if (bulkPurpose.trim()) updates.purpose = bulkPurpose.trim();
    if (!Object.keys(updates).length && !bulkCollectionId) return;
    bulkSaving = true;
    try {
      const ids = [...bulkSelected];
      const messages: string[] = [];
      if (Object.keys(updates).length) {
        const result = await api.bulkUpdate(ids, updates);
        messages.push(`updated ${result.updated}`);
      }
      if (bulkCollectionId) {
        const collection = collections.find((entry) => entry.id === Number(bulkCollectionId));
        await Promise.all(ids.map((id) => api.addToCollection(Number(bulkCollectionId), id)));
        messages.push(`added ${ids.length} to ${collection?.name ?? 'collection'}`);
      }
      toast(`${messages.join(' · ')} item${ids.length === 1 ? '' : 's'}`);
      bulkCategory = ''; bulkTags = ''; bulkPurpose = ''; bulkCollectionId = '';
      exitBulkMode();
      await load();
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Bulk update failed'); }
    finally { bulkSaving = false; }
  }
  function goToPage(next: number) {
    if (loading || next < 1 || next > totalPages || next === page) return;
    void load(next);
    cardsEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function returnLocation(): string {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (type) params.set('type', type);
    if (category) params.set('category', category);
    if (purpose) params.set('purpose', purpose);
    if (tag) params.set('tag', tag);
    if (page > 1) params.set('page', String(page));
    if (view !== 'covers') params.set('view', view);
    if (!previewOpen) params.set('preview', 'closed');
    const search = params.toString();
    return `/library${search ? `?${search}` : ''}`;
  }
  function read(item: Item) { void goto(`/reader/${item.id}?returnTo=${encodeURIComponent(returnLocation())}`); }
  function openFile(item: Item) { void api.open(item.id); }
  async function saved(updated: Item) { selected = updated; items = items.map((item) => item.id === updated.id ? updated : item); toast(`Metadata updated for “${shortTitle(updated.title)}”`); }
  async function refreshSelected() { if (selected) await select(selected); await loadFilters(); }
  async function remove(item: Item) { await api.delete(item.id); selected = null; toast(`Removed “${shortTitle(item.title)}” from the library`); await load(); await loadFilters(); }
  /** Toasts read better short. */
  function shortTitle(title: string) { return title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title; }

  function setView(next: 'covers' | 'table') {
    view = next;
    localStorage.setItem('library-catalog-view', next);
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    query = params.get('q') ?? '';
    type = params.get('type') ?? '';
    category = params.get('category') ?? '';
    purpose = params.get('purpose') ?? '';
    tag = params.get('tag') ?? '';
    page = Math.max(1, Number(params.get('page')) || 1);
    view = params.get('view') === 'table' || (!params.has('view') && localStorage.getItem('library-catalog-view') === 'table') ? 'table' : 'covers';
    previewOpen = params.get('preview') !== 'closed';
    // Page size comes from settings before the first query so the initial
    // page holds the user's configured number of books.
    void api.settings()
      .then((settings: AppSettings) => {
        if (settings.catalog_page_size) pageSize = settings.catalog_page_size;
      })
      .catch(() => { /* fall back to the built-in default */ })
      .finally(() => void Promise.all([load(page), loadFilters()]));
    return () => { if (searchTimer) clearTimeout(searchTimer); };
  });
</script>

<div class="library-page flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-6 md:overflow-hidden" class:preview-hidden={!previewOpen}>
    <!-- Filter bar: the shell keeps it in place on desktop; only the list scrolls. -->
    <div class="shrink-0 rounded-xl border border-border/70 bg-surface-0/90 p-2 shadow-sm">
        <div class="flex flex-wrap items-center gap-2">
        <form class="flex min-w-[min(100%,24rem)] flex-1" onsubmit={(event) => { event.preventDefault(); if (searchTimer) clearTimeout(searchTimer); page = 1; void load(1); }}>
          <label class="sr-only" for="library-search">Search library</label>
          <div class="relative w-full">
            <input id="library-search" value={query} oninput={(event) => queryChanged((event.currentTarget as HTMLInputElement).value)} class="ui-field text-xs" placeholder="Search titles, authors, metadata, document text" autocomplete="off" />
          </div>
        </form>
          <div class="flex rounded-lg border border-border bg-surface-1 p-0.5" aria-label="Catalog view">
            <button class="rounded-md px-2 py-1.5 text-[11px]" class:bg-surface-3={view === 'covers'} class:text-text-primary={view === 'covers'} class:text-text-muted={view !== 'covers'} onclick={() => setView('covers')}>Covers</button>
            <button class="rounded-md px-2 py-1.5 text-[11px]" class:bg-surface-3={view === 'table'} class:text-text-primary={view === 'table'} class:text-text-muted={view !== 'table'} onclick={() => setView('table')}>Table</button>
          </div>
          <Toggle checked={previewOpen} onChange={(next) => (previewOpen = next)} label="Preview" />
        </div>
        <div class="filter-grid mt-2">
          <SelectMenu value={type} options={(facets?.type ?? []).map((facet) => ({ value: facet.name, label: `${facet.name} (${facet.count})` }))} placeholder="All types" label="Filter by type" onChange={(value) => { type = value; filterChanged(); }} />
          <SelectMenu value={category} options={categories.map((facet) => ({ value: facet.name, label: `${facet.name} (${facet.count})` }))} placeholder="All categories" label="Filter by category" onChange={(value) => { category = value; filterChanged(); }} />
          <SelectMenu value={purpose} options={purposes.map((facet) => ({ value: facet.name, label: `${facet.name} (${facet.count})` }))} placeholder="All purposes" label="Filter by purpose" onChange={(value) => { purpose = value; filterChanged(); }} />
          <SelectMenu value={tag} options={tags.map((facet) => ({ value: facet.name, label: `${facet.name} (${facet.count})` }))} placeholder="All tags" label="Filter by tag" onChange={(value) => { tag = value; filterChanged(); }} />
        </div>
      </div>

      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-[11px] text-text-secondary"><span>{total} items</span><div class="flex items-center gap-3">{#if query || type || category || purpose || tag}<button class="text-accent hover:underline" onclick={clearFilters}>Clear filters</button>{/if}<button class="text-accent hover:underline" onclick={() => bulkMode ? exitBulkMode() : (bulkMode = true)}>{bulkMode ? 'Cancel selection' : 'Select items'}</button></div></div>

      {#if bulkMode}<div class="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-accent/25 bg-accent/5 p-3"><div class="w-32"><label class="text-[10px] text-text-muted" for="bulk-category">Category</label><input id="bulk-category" class="ui-field mt-1 w-full text-xs" bind:value={bulkCategory} placeholder="research" /></div><div class="w-32"><label class="text-[10px] text-text-muted" for="bulk-tags">Tags</label><input id="bulk-tags" class="ui-field mt-1 w-full text-xs" bind:value={bulkTags} placeholder="comma,separated" /></div><div class="w-32"><label class="text-[10px] text-text-muted" for="bulk-purpose">Purpose</label><input id="bulk-purpose" class="ui-field mt-1 w-full text-xs" bind:value={bulkPurpose} placeholder="learning" /></div><div class="w-44"><label class="text-[10px] text-text-muted" for="bulk-collection">Add to collection</label><select id="bulk-collection" class="ui-field mt-1 w-full text-xs" bind:value={bulkCollectionId}><option value="">No collection</option>{#each collections as collection}<option value={collection.id}>{collection.name}</option>{/each}</select></div><button class="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50" disabled={!items.length || bulkSaving} onclick={selectVisible}>Select visible</button><button class="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50" disabled={!bulkSelected.size || bulkSaving} onclick={() => void applyBulk()}>{bulkSaving ? 'Saving…' : `Apply to ${bulkSelected.size}`}</button></div>{/if}

      <!-- The only scroll region: results and their pagination. -->
      <section class="cards-region min-h-0 md:min-h-0 md:overflow-y-auto md:pr-1" bind:this={cardsEl}>
      {#if error}<EmptyState title="Library unavailable" message={error} actionLabel="Retry" actionHref="/library" />
      {:else if loading}
        <div class="book-grid" aria-hidden="true">
          {#each Array(Math.min(pageSize, 12)) as _}
            <div class="rounded-xl border border-border bg-surface-1 p-2.5">
              <div class="mb-2.5 aspect-[3/4] animate-pulse rounded-lg bg-surface-2"></div>
              <div class="mb-1.5 h-3 animate-pulse rounded bg-surface-2"></div>
              <div class="mb-1.5 h-2 w-2/3 animate-pulse rounded bg-surface-2"></div>
              <div class="h-2 w-1/3 animate-pulse rounded bg-surface-2"></div>
            </div>
          {/each}
        </div>
      {:else}
        {#if insideMatches.length}
          <section class="mb-4 rounded-xl border border-accent/25 bg-accent/5 p-3" aria-label="Inside documents">
            <div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">Inside indexed documents</div>
            <div class="space-y-1.5">
              {#each insideMatches as match (match.item.id + match.location)}
                <button class="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-1" onclick={() => select(match.item)}>
                  <span class="text-xs font-medium text-text-primary">{match.item.title}</span>
                  <span class="ml-1 text-[10px] text-text-muted">{match.location}{match.heading ? ` · ${match.heading}` : ''}</span>
                  <span class="block truncate text-[11px] text-text-secondary">{match.snippet.replaceAll('<mark>', '').replaceAll('</mark>', '')}</span>
                </button>
              {/each}
            </div>
          </section>
        {/if}
         {#if items.length === 0}<EmptyState title="No matching items" message="Try another filter or scan a folder from Settings." actionHref="/settings" actionLabel="Open settings" />
         {:else if view === 'table'}<LibraryTable {items} selectedId={selected?.id} onSelect={select} onRead={read} {bulkMode} {bulkSelected} onToggleBulk={toggleBulk} />
         {:else}<div class="book-grid">{#each items as item (item.id)}<BookCard {item} isSelected={selected?.id === item.id} query={query} isReading={!!item.progress && item.progress.status === 'reading'} progressPercent={item.progress?.progress_percent ?? 0} {bulkMode} isBulkSelected={bulkSelected.has(item.id)} onClick={select} onRead={read} onToggleBulk={toggleBulk} />{/each}</div>{/if}
      {/if}

      {#if !loading && totalPages > 1}
        <div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px] text-text-muted">
          <span>Page {page} of {totalPages} · {pageSize} per page</span>
          <Pagination {page} {totalPages} onChange={goToPage} label="Library pagination" />
        </div>
      {/if}
      </section>

    {#if previewOpen}<aside class="preview-rail min-h-[30rem] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-0 md:h-full md:w-auto md:min-h-0" aria-label="Selected item preview">{#if selected}<DetailPanel item={selected} {progress} {sessions} isQueued={!!dashboard?.queue.some((entry) => entry.item_id === selected?.id)} onOpen={openFile} onDelete={(item) => void remove(item)} onRead={read} onSaved={saved} onProgressChanged={refreshSelected} onQueueChanged={loadFilters} />{:else}<div class="flex h-full min-h-[30rem] items-center justify-center p-8 text-center text-xs text-text-secondary">Select a book to preview its cover, first page, metadata, and reading state.</div>{/if}</aside>{/if}
  </div>

<style>
  .filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: .5rem; }
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.75rem, 1fr)); gap: .75rem; align-items: start; }
  /* Desktop catalog: filters are fixed and only the cards column scrolls;
     the preview rail fills the remaining height. */
  .library-page { min-width: 0; }
  .library-page { min-width: 0; min-height: 0; }
  @media (min-width: 48rem) {
    /* Desktop catalog: the shell never scrolls. The filter bar and the item
       count stay put; row three holds the one scroll region and the full-height
       preview rail. */
    .library-page {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(21rem, 30rem);
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: .75rem 1rem;
    }
    .cards-region { grid-column: 1; grid-row: 3; min-height: 0; scrollbar-width: thin; }
    .preview-rail { grid-column: 2; grid-row: 3; min-height: 0; }
    /* With the preview toggled off the catalog takes the full width. */
    .library-page.preview-hidden { grid-template-columns: minmax(0, 1fr); }
    .library-page.preview-hidden .cards-region { grid-column: 1; }
  }
  @media (min-width: 1500px) { .book-grid { grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); } }
</style>
