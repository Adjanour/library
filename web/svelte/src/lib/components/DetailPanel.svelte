<script lang="ts">
  import { api, type Item, type ReadingProgress, type ReadingSession } from '$lib/api';
  import { fileExt, formatSize, purposeColor } from '$lib/utils';
  import MetadataEditor from './MetadataEditor.svelte';

  let {
    item,
    progress,
    sessions,
    activeSession,
    onOpen,
    onDelete,
    onRead,
    onSaved,
    onProgressChanged,
    onSessionChanged
  }: {
    item: Item | null;
    progress: ReadingProgress | null;
    sessions: ReadingSession[];
    activeSession: { item_id: number; session_id: number } | null;
    onOpen: (item: Item) => void;
    onDelete: (item: Item) => void;
    onRead: (item: Item) => void;
    onSaved: (updated: Item) => void;
    onProgressChanged: () => void;
    onSessionChanged: () => void;
  } = $props();

  let editInput = $state({ percent: 0, page: 0, pages: 0 });
  let infoCollapsed = $state(true);
  let epubCoverUrl = $state('');

  // Reset collapse state when item changes
  $effect(() => {
    if (item) { infoCollapsed = true; }
  });

  $effect(() => {
    if (progress) {
      editInput = { percent: progress.progress_percent, page: progress.current_page, pages: progress.total_pages };
    } else if (item) {
      editInput = { percent: 0, page: 0, pages: 0 };
    }
  });

  // Load epub cover when item changes
  $effect(() => {
    epubCoverUrl = '';
    if (!item) return;
    const e = fileExt(item.filename);
    if (e !== 'epub') return;

    let cancelled = false;
    (async () => {
      try {
        // @ts-expect-error The package's browser bundle lacks a declaration file.
        const ePub = (await import('@intity/epub-js/dist/public/epub.js')).default;
        const res = await fetch(`/api/file/${item.id}`);
        if (!res.ok || cancelled) return;
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const book = ePub();
        await book.open(buf, 'binary');
        await book.opened;
        if (cancelled) {
          book.destroy();
          return;
        }
        const url = await book.coverUrl();
        if (!cancelled) epubCoverUrl = url || '';
        book.destroy();
      } catch {}
    })();

    return () => { cancelled = true; };
  });

  const previewUrl = $derived(item ? `/api/file/${item.id}` : '');
  const ext = $derived(item ? fileExt(item.filename) : '');

  async function startReading() {
    if (!item) return;
    try { await api.startReading(item.id); onSessionChanged(); } catch (e) { console.error(e); }
  }
  async function stopReading() {
    if (!item) return;
    try { await api.stopReading(item.id, editInput.page); onSessionChanged(); } catch (e) { console.error(e); }
  }
  async function updateProgress() {
    if (!item) return;
    try {
      await api.updateProgress(item.id, {
        progress_percent: editInput.percent, current_page: editInput.page, total_pages: editInput.pages
      });
      onProgressChanged();
    } catch (e) { console.error(e); }
  }
  async function finishBook() {
    if (!item) return;
    try { await api.finishReading(item.id); onProgressChanged(); } catch (e) { console.error(e); }
  }
</script>

{#if item}
  <div class="flex flex-col h-full">
    <!-- Collapse toggle bar -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 shrink-0">
      <button class="p-1 rounded hover:bg-surface-3 transition-colors" title={infoCollapsed ? 'Show info' : 'Hide info'} onclick={() => (infoCollapsed = !infoCollapsed)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" class="transition-transform" style={infoCollapsed ? '' : 'transform: rotate(90deg)'}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <div class="text-xs text-text-secondary truncate flex-1">{item.title}</div>
      {#if infoCollapsed}
        <button class="text-[10px] px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors" onclick={() => onRead(item)}>Read</button>
        <button class="text-[10px] px-2 py-0.5 rounded bg-surface-2 border border-border hover:bg-surface-3 transition-colors" onclick={() => onOpen(item)}>Open</button>
      {/if}
    </div>

    {#if !infoCollapsed}
    <!-- Metadata section -->
    <div class="p-4 border-b border-border overflow-y-auto" style="max-height: 45%">
      <div class="flex items-start gap-2 mb-3">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" class="text-accent/70 mt-0.5 shrink-0">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
        </svg>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-semibold leading-tight">{item.title}</h2>
          <div class="text-xs text-text-secondary mt-0.5">{item.authors || 'Unknown author'}{item.year ? ` · ${item.year}` : ''}</div>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5 mb-3">
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">{item.type}</span>
        {#if item.category}<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">{item.category}</span>{/if}
        {#if item.purpose}<span class="text-[10px] px-1.5 py-0.5 rounded {purposeColor(item.purpose)}">{item.purpose}</span>{/if}
      </div>

      {#if item.tags}
        <div class="flex flex-wrap gap-1 mb-3">
          {#each item.tags.split(',').filter((t) => t.trim()) as tag}
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">#{tag.trim()}</span>
          {/each}
        </div>
      {/if}

      {#if item.description}
        <p class="text-xs text-text-secondary leading-relaxed mb-3 line-clamp-4">{item.description}</p>
      {/if}

      <div class="text-[10px] text-text-muted mb-3 space-y-0.5">
        <div class="truncate" title={item.path}>{item.path}</div>
        <div>{formatSize(item.size)} · added {new Date(item.added_at).toLocaleDateString()}</div>
      </div>

      <MetadataEditor {item} onSaved={onSaved} />

      <div class="flex gap-2 mt-3">
        <button class="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors flex items-center gap-1.5" onclick={() => onOpen(item)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open (o)
        </button>
        {#if ext === 'pdf' || ext === 'epub'}
          <button class="px-3 py-1.5 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors flex items-center gap-1.5" onclick={() => onRead(item)}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
            Read (r)
          </button>
        {/if}
        <button class="px-3 py-1.5 text-xs bg-error/20 text-error rounded hover:bg-error/30 transition-colors" onclick={() => onDelete(item)}>Delete (d)</button>
      </div>
    </div>

    <!-- Reading progress section -->
    <div class="p-4 border-b border-border">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-2">Reading Progress</div>

      {#if progress && progress.status !== 'unread'}
        <div class="mb-3">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="capitalize text-text-secondary">{progress.status}</span>
            <span class="text-text-muted">{progress.progress_percent}%</span>
          </div>
          <div class="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div class="h-full bg-accent transition-all" style="width: {progress.progress_percent}%"></div>
          </div>
        </div>
      {/if}

      <div class="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label for="percent" class="text-[10px] text-text-muted">Percent</label>
          <input id="percent" type="number" min="0" max="100" bind:value={editInput.percent} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
        </div>
        <div>
          <label for="page" class="text-[10px] text-text-muted">Page</label>
          <input id="page" type="number" min="0" bind:value={editInput.page} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
        </div>
        <div>
          <label for="total" class="text-[10px] text-text-muted">Total</label>
          <input id="total" type="number" min="0" bind:value={editInput.pages} class="w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs" />
        </div>
      </div>

      <div class="flex gap-2 flex-wrap">
        {#if activeSession?.item_id === item.id}
          <button class="px-2.5 py-1 text-xs bg-warning/20 text-warning rounded hover:bg-warning/30 transition-colors" onclick={stopReading}>Stop Reading</button>
        {:else}
          <button class="px-2.5 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors" onclick={startReading}>Start Reading</button>
        {/if}
        <button class="px-2.5 py-1 text-xs bg-surface-2 border border-border rounded hover:bg-surface-3 transition-colors" onclick={updateProgress}>Update</button>
        <button class="px-2.5 py-1 text-xs bg-success/20 text-success rounded hover:bg-success/30 transition-colors" onclick={finishBook}>Mark Finished</button>
      </div>

      {#if sessions.length > 0}
        <div class="mt-3 border-t border-border pt-2">
          <div class="text-[10px] text-text-muted mb-1">Recent Sessions</div>
          {#each sessions.slice(0, 3) as s}
            <div class="text-[10px] text-text-secondary">
              {new Date(s.started_at).toLocaleDateString()} — {Math.floor((s.duration_seconds || 0) / 60)}m
              {#if s.pages_read}· {s.pages_read} pages{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {/if}

    <!-- Preview -->
    <div class="flex-1 overflow-hidden bg-surface-1">
      {#if ext === 'pdf'}
        <iframe src={previewUrl} class="w-full h-full" title="PDF preview"></iframe>
      {:else if ext === 'epub' && epubCoverUrl}
        <div class="flex flex-col items-center justify-center h-full p-6 gap-4">
          <img src={epubCoverUrl} alt={item.title} class="max-h-[60%] max-w-full object-contain rounded shadow-lg" />
          <div class="text-center">
            <div class="text-sm font-medium">{item.title}</div>
            <div class="text-xs text-text-muted mt-0.5">{item.authors || 'Unknown author'}</div>
          </div>
        </div>
      {:else if ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)}
        <div class="flex items-center justify-center h-full p-4">
          <img src={previewUrl} alt={item.title} class="max-w-full max-h-full object-contain" />
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-text-muted p-8">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="mb-3 opacity-30">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/>
          </svg>
          <div class="text-sm">No inline preview for .{ext}</div>
          <div class="text-xs mt-1">Press r to read or o to open externally</div>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center h-full text-text-muted">
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="mb-4 opacity-30">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    </svg>
    <div class="text-sm">Select an item from the list</div>
    <div class="text-xs mt-1 text-text-muted">Press ? for keyboard shortcuts</div>
  </div>
{/if}
