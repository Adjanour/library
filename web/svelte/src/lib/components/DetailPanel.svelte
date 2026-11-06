<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { api, type ContentIndexState, type Item, type MetadataEvidence, type MetadataSuggestion, type ReadingProgress, type ReadingSession } from '$lib/api';
  import { fileExt, formatSize, purposeColor } from '$lib/utils';
  import { toast } from '$lib/toast.svelte';
  import { reducedMotion } from '$lib/motion';
  import MetadataEditor from './MetadataEditor.svelte';

  let {
    item,
    progress,
    sessions,
    onOpen,
    onDelete,
    onRead,
    onSaved,
    onProgressChanged,
    isQueued,
    onQueueChanged
  }: {
    item: Item | null;
    progress: ReadingProgress | null;
    sessions: ReadingSession[];
    onOpen: (item: Item) => void;
    onDelete: (item: Item) => void;
    onRead: (item: Item) => void;
    onSaved: (updated: Item) => void;
    onProgressChanged: () => void;
    isQueued: boolean;
    onQueueChanged: () => void;
  } = $props();

  let editInput = $state({ percent: 0, page: 0, pages: 0 });
  // Covers and the first-page preview are separate resources with separate fallbacks.
  let coverFailed = $state(false);
  let previewFailed = $state(false);
  // The fill springs to its value shortly after mount.
  let barsMounted = $state(false);
  let metadataEvidence = $state<MetadataEvidence[]>([]);
  let relatedCopies = $state<Item[]>([]);
  let contentIndex = $state<ContentIndexState | null>(null);
  let indexingContent = $state(false);
  let suggestions = $state<MetadataSuggestion[]>([]);
  let enriching = $state(false);
  let grobidConfigured = $state(false);

  $effect(() => {
    if (item) { coverFailed = false; previewFailed = false; barsMounted = false; }
  });

  $effect(() => {
    const id = item?.id;
    metadataEvidence = [];
    relatedCopies = [];
    contentIndex = null;
    suggestions = [];
    if (!id) return;
    let cancelled = false;
    void Promise.all([api.metadataEvidence(id), api.relatedCopies(id), api.contentIndexState(id), api.metadataSuggestions(id), api.settings()])
      .then(([nextEvidence, nextRelated, nextContentIndex, nextSuggestions, settings]) => {
        if (!cancelled) {
          metadataEvidence = nextEvidence;
          relatedCopies = nextRelated;
          contentIndex = nextContentIndex;
          suggestions = nextSuggestions;
          grobidConfigured = Boolean(settings.grobid_configured);
        }
      })
      .catch(() => { /* older runtimes can still show the ordinary metadata */ });
    return () => { cancelled = true; };
  });

  $effect(() => {
    if (progress) {
      editInput = { percent: progress.progress_percent, page: progress.current_page, pages: progress.total_pages };
    } else if (item) {
      editInput = { percent: 0, page: 0, pages: 0 };
    }
  });

  onMount(() => undefined);

  $effect(() => {
    if (item) {
      const handle = requestAnimationFrame(() => (barsMounted = true));
      return () => cancelAnimationFrame(handle);
    }
  });

  const previewUrl = $derived(item ? `/api/file/${item.id}` : '');
  const thumbnailUrl = $derived(item ? `/api/thumbnail/${item.id}` : '');
  const ext = $derived(item ? fileExt(item.filename) : '');
  const readable = $derived(ext === 'pdf' || ext === 'epub');
  const tags = $derived(item ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : []);

  const lastSession = $derived(sessions.length > 0 ? sessions[0] : null);

  function relativeDay(iso: string) {
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  function sessionSummary(session: ReadingSession | null) {
    if (!session) return null;
    const minutes = Math.round((session.duration_seconds || 0) / 60);
    if (minutes <= 0 && !session.pages_read) return null;
    return `${minutes}m${session.pages_read ? ` · ${session.pages_read} pages` : ''}`;
  }

  function clampPercent(value: number) {
    return Math.min(100, Math.max(2, value));
  }

  function sourceLabel(source: MetadataEvidence['source']) {
    return ({
      pdf_embedded: 'PDF metadata',
      pdf_first_pages: 'PDF first pages',
      epub_opf: 'EPUB metadata',
      filename: 'Filename',
      ocr: 'OCR',
      grobid: 'GROBID',
      crossref: 'Crossref',
      open_library: 'Open Library',
      manual: 'Manual correction'
    })[source];
  }
  async function indexDocument(ocr = false) {
    if (!item || indexingContent) return;
    indexingContent = true;
    try {
      const result = await api.indexContent(item.id, ocr);
      contentIndex = await api.contentIndexState(item.id);
      toast(result.status === 'needs_ocr' ? 'This PDF appears image-only. Run OCR to search it.' : `Indexed ${result.chunks} text sections`);
    } catch (e) { console.error(e); toast('Could not index this document'); }
    finally { indexingContent = false; }
  }
  async function findMetadata() {
    if (!item || enriching) return;
    enriching = true;
    try {
      const result = await api.enrich(item.id, true);
      suggestions = result.suggestions;
      toast(result.saved ? `Found ${result.saved} metadata suggestions` : 'No reliable metadata match found');
    } catch (e) { console.error(e); toast('Metadata lookup was unavailable'); }
    finally { enriching = false; }
  }
  async function resolveSuggestion(suggestion: MetadataSuggestion, apply: boolean) {
    try {
      const updated = await api.resolveSuggestion(suggestion.id, apply);
      suggestions = suggestions.filter((entry) => entry.id !== suggestion.id);
      if (updated) onSaved(updated);
      toast(apply ? `${suggestion.field} applied` : 'Suggestion dismissed');
    } catch (e) { console.error(e); toast('Could not update suggestion'); }
  }
  async function extractGrobid() {
    if (!item || enriching) return;
    enriching = true;
    try {
      const result = await api.extractGrobid(item.id);
      suggestions = result.suggestions;
      toast(result.saved ? `GROBID found ${result.saved} suggestions` : 'GROBID found no usable header metadata');
    } catch (e) { console.error(e); toast('GROBID extraction was unavailable'); }
    finally { enriching = false; }
  }

  async function updateProgress() {
    if (!item) return;
    try {
      await api.updateProgress(item.id, {
        progress_percent: editInput.percent, current_page: editInput.page, total_pages: editInput.pages
      });
      onProgressChanged();
      toast('Progress updated');
    } catch (e) { console.error(e); }
  }
  async function addToQueue() {
    if (!item || isQueued) return;
    try {
      await api.addToQueue({ item_id: item.id, title: item.title, author: item.authors });
      onQueueChanged();
      toast(`Added “${item.title}” to the queue`);
    } catch (e) { console.error(e); }
  }
  async function finishBook() {
    if (!item) return;
    try { await api.finishReading(item.id); onProgressChanged(); toast('Marked as finished'); } catch (e) { console.error(e); }
  }
</script>

{#if item}
  <div class="flex h-full flex-col">
    {#key item.id}
    <div class="flex min-h-0 flex-col" in:fade={{ duration: reducedMotion() ? 0 : 150 }}>
      <!-- Sheet header: cover, identity, primary actions -->
      <div class="flex gap-4 border-b border-border p-4 pb-3" in:fly={{ y: 6, duration: reducedMotion() ? 0 : 200 }}>
        {#if readable && !coverFailed}
          <img src={thumbnailUrl} alt="" aria-hidden="true" class="aspect-[2/3] w-16 shrink-0 rounded-sm object-cover shadow-md" onerror={() => (coverFailed = true)} />
        {:else}
          <div class="aspect-[2/3] w-16 shrink-0 rounded-sm border border-border bg-gradient-to-br from-surface-3 via-surface-2 to-surface-1 shadow-md"></div>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-2">
            <h2 class="min-w-0 flex-1 text-sm font-medium leading-snug tracking-[-0.01em]">{item.title}</h2>
            <button
              class="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-error/15 hover:text-error"
              title="Delete (d)"
              aria-label={`Delete ${item.title}`}
              onclick={() => onDelete(item)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
          </div>
          <div class="mt-1 truncate text-xs text-text-secondary">{item.authors || 'Unknown author'}{item.year ? ` · ${item.year}` : ''}</div>
          <div class="mt-1.5 flex flex-wrap gap-1">
            <span class="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-secondary">{item.type}</span>
            {#if item.purpose}<span class="rounded px-1.5 py-0.5 text-[10px] {purposeColor(item.purpose)}">{item.purpose}</span>{/if}
            {#if item.category}<span class="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{item.category}</span>{/if}
            {#each tags.slice(0, 3) as tag}
              <span class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">#{tag}</span>
            {/each}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap gap-2 border-b border-border p-3">
        {#if readable}
          <button class="ui-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs" onclick={() => onRead(item)}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
            Read (r)
          </button>
        {/if}
        <button class="ui-button px-3 py-1.5 text-xs" onclick={() => onOpen(item)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          Open (o)
        </button>
        {#if !isQueued}
          <button class="ui-button px-3 py-1.5 text-xs" onclick={addToQueue}>Add to queue</button>
        {:else}
          <span class="px-3 py-1.5 text-xs text-success bg-success/10 rounded">Queued</span>
        {/if}
        {#if ext === 'pdf' || ext === 'epub'}
          <button class="ui-button px-3 py-1.5 text-xs" disabled={indexingContent} onclick={() => indexDocument(contentIndex?.status === 'needs_ocr')}>
            {#if indexingContent}Indexing…{:else if contentIndex?.status === 'indexed' || contentIndex?.status === 'truncated'}Re-index text{:else if contentIndex?.status === 'needs_ocr'}Run OCR{:else}Index text{/if}
          </button>
        {/if}
      </div>

      <!-- Scrolling body -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <!-- Reading state -->
        <section class="border-b border-border p-4">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[10px] uppercase tracking-wider text-text-muted">Reading state</span>
            {#if progress && progress.status !== 'unread'}
              <span class="text-[10px] capitalize text-text-secondary">{progress.status}</span>
            {/if}
          </div>
          {#if progress && progress.status !== 'unread'}
            <div class="flex items-center gap-2.5">
              <div class="progress-track h-1.5 flex-1" role="progressbar" aria-valuenow={Math.round(progress.progress_percent)} aria-valuemin="0" aria-valuemax="100" aria-label={`Progress in ${item.title}`}>
                <div class="progress-fill" style:width={barsMounted ? `${clampPercent(progress.progress_percent)}%` : '0%'}></div>
              </div>
              <span class="shrink-0 text-xs text-text-primary">{Math.round(progress.progress_percent)}%</span>
            </div>
            {#if lastSession}
              <p class="mt-1.5 text-[11px] text-text-muted">Last read {relativeDay(lastSession.started_at)}{sessionSummary(lastSession) ? ` · ${sessionSummary(lastSession)}` : ''}</p>
            {/if}
          {:else}
            <div class="progress-track h-1.5 w-full"><div class="progress-fill" style:width="0%"></div></div>
            <p class="mt-1.5 text-[11px] text-text-muted">Not started — opening the reader begins a session.</p>
          {/if}

          <!-- Manual progress lives behind a quiet disclosure -->
          <details class="group mt-2">
            <summary class="cursor-pointer select-none text-[11px] text-text-secondary hover:text-text-primary">Adjust progress</summary>
            <div class="mt-2 grid grid-cols-3 gap-2">
              <div>
                <label for="percent" class="text-[10px] text-text-muted">Percent</label>
                <input id="percent" type="number" min="0" max="100" bind:value={editInput.percent} class="ui-field text-xs" />
              </div>
              <div>
                <label for="page" class="text-[10px] text-text-muted">Page</label>
                <input id="page" type="number" min="0" bind:value={editInput.page} class="ui-field text-xs" />
              </div>
              <div>
                <label for="total" class="text-[10px] text-text-muted">Total</label>
                <input id="total" type="number" min="0" bind:value={editInput.pages} class="ui-field text-xs" />
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <button class="ui-button px-2.5 py-1 text-xs" onclick={updateProgress}>Update</button>
              <button class="px-2.5 py-1 text-xs text-success bg-success/15 rounded transition-colors hover:bg-success/25" onclick={finishBook}>Mark Finished</button>
            </div>
          </details>

          {#if sessions.length > 1}
            <div class="mt-3 border-t border-border pt-2">
              {#each sessions.slice(1, 4) as s}
                <div class="text-[10px] text-text-secondary">
                  {new Date(s.started_at).toLocaleDateString()} — {Math.round((s.duration_seconds || 0) / 60)}m{#if s.pages_read} · {s.pages_read} pages{/if}
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <!-- File facts -->
        <section class="border-b border-border p-4 text-[10px] text-text-muted">
          <div class="truncate" title={item.path}>{item.path}</div>
          <div class="mt-0.5">{formatSize(item.size)} · added {new Date(item.added_at).toLocaleDateString()}</div>
          {#if item.doi || item.isbn || item.arxiv_id}
            <div class="mt-2 flex flex-wrap gap-1">
              {#if item.doi}<span class="rounded bg-surface-3 px-1.5 py-0.5">DOI {item.doi}</span>{/if}
              {#if item.isbn}<span class="rounded bg-surface-3 px-1.5 py-0.5">ISBN {item.isbn}</span>{/if}
              {#if item.arxiv_id}<span class="rounded bg-surface-3 px-1.5 py-0.5">arXiv {item.arxiv_id}</span>{/if}
            </div>
          {/if}
          {#if relatedCopies.length > 0}
            <div class="mt-2 text-warning">{relatedCopies.length} related {relatedCopies.length === 1 ? 'copy' : 'copies'} found</div>
          {/if}
          {#if item.description}
            <p class="mt-2 text-xs leading-relaxed text-text-secondary line-clamp-4">{item.description}</p>
          {/if}
          <div class="mt-3 border-t border-border pt-2">
            <div class="flex items-center justify-between gap-2">
              <span>Online metadata suggestions</span>
              <div class="flex gap-1">
                {#if grobidConfigured && ext === 'pdf'}
                  <button class="ui-button px-2 py-1 text-[10px]" disabled={enriching} onclick={extractGrobid}>{enriching ? 'Extracting…' : 'Extract with GROBID'}</button>
                {/if}
                <button class="ui-button px-2 py-1 text-[10px]" disabled={enriching} onclick={findMetadata}>{enriching ? 'Looking up…' : 'Find metadata online'}</button>
              </div>
            </div>
            <p class="mt-1 text-[10px] text-text-secondary">Uses Crossref and Open Library only when you click. A DOI/ISBN is preferred; otherwise the title and author are sent for a match.{#if grobidConfigured && ext === 'pdf'} GROBID sends this PDF to the endpoint configured by you, only when clicked.{/if}</p>
            {#if suggestions.length > 0}
              <div class="mt-2 space-y-1.5">
                {#each suggestions as suggestion (suggestion.id)}
                  <div class="rounded border border-border bg-surface-1 p-2 text-[10px]">
                    <div class="break-words text-text-primary"><span class="text-text-muted">{suggestion.field} · {suggestion.source} · {Math.round(suggestion.confidence * 100)}%</span><br />{suggestion.value}</div>
                    <div class="mt-1.5 flex gap-1.5"><button class="ui-button px-2 py-0.5 text-[10px]" onclick={() => resolveSuggestion(suggestion, true)}>Apply</button><button class="px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary" onclick={() => resolveSuggestion(suggestion, false)}>Dismiss</button></div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          {#if metadataEvidence.length > 0}
            <details class="mt-2">
              <summary class="cursor-pointer text-text-secondary">Metadata evidence ({metadataEvidence.length})</summary>
              <div class="mt-1.5 space-y-1">
                {#each metadataEvidence as candidate}
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 truncate" title={candidate.value}>{candidate.field}: {candidate.value}</span>
                    <span class="shrink-0">{sourceLabel(candidate.source)} · {Math.round(candidate.confidence * 100)}%</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </section>

        <!-- Editable metadata, collapsed by default -->
        <section class="border-b border-border p-4">
          <details>
            <summary class="cursor-pointer select-none text-[11px] text-text-secondary hover:text-text-primary">Edit metadata</summary>
            <div class="mt-2">
              <MetadataEditor {item} onSaved={onSaved} />
            </div>
          </details>
        </section>

        <!-- First-page preview -->
        {#if readable && !previewFailed}
          <section class="flex flex-col items-center p-4 pb-6">
            <img
              src={previewUrl}
              alt={`Preview of ${item.title}`}
              class="max-h-64 max-w-full rounded-md border border-border object-contain shadow-lg"
              onerror={() => (previewFailed = true)}
            />
            <div class="mt-2 text-[10px] text-text-muted">First page · press r to read</div>
          </section>
        {:else if ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)}
          <section class="flex items-center justify-center p-4 pb-6">
            <img src={previewUrl} alt={item.title} class="max-w-full rounded-md border border-border" />
          </section>
        {/if}
      </div>
    </div>
    {/key}
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
