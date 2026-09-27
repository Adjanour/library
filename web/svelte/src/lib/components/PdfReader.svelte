<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { api } from "$lib/api";
    import { DEFAULT_READER_PREFERENCES, loadReaderPreferences } from "$lib/readerPreferences";
    import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

    let {
        item,
        onReady,
        onProgress,
    }: {
        item: { id: number; title: string; filename: string };
        onReady?: (totalPages: number) => void;
        onProgress?: (currentPage: number, totalPages: number) => void;
    } = $props();

    let container: HTMLDivElement | null = null;
    let viewerEl: HTMLDivElement | null = null;

    let loading = $state(true);
    let error = $state("");
    let totalPages = $state(0);
    let currentPage = $state(1);
    const DEFAULT_SCALE = DEFAULT_READER_PREFERENCES.pdfZoom;
    let scalePct = $state(DEFAULT_SCALE);
    let showSearch = $state(false);
    let searchQuery = $state("");
    let matchCurrent = $state(0);
    let matchTotal = $state(0);
    let showToc = $state(false);
    let outline = $state<{ title: string; dest: any; depth: number }[]>([]);

    let mounted = true;
    let pdfjs: any = null;
    let viewerMod: any = null;
    let pdfViewer: any = null;
    let eventBus: any = null;
    let linkService: any = null;
    let findController: any = null;
    let pdfDoc: any = null;
    let loadingTask: any = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let searchDebounce: ReturnType<typeof setTimeout> | null = null;

    function createRangeTransport(BaseTransport: any, fileUrl: string, length: number, initialData: Uint8Array) {
        const Transport = class extends BaseTransport {
            _tUrl = fileUrl;
            _tCtrl = new AbortController();
            constructor() {
                super(length, initialData);
            }
            async requestDataRange(begin: number, end: number) {
                const res = await fetch(this._tUrl, {
                    headers: { Range: `bytes=${begin}-${end - 1}` },
                    signal: this._tCtrl.signal,
                });
                if (res.status !== 206) throw new Error(`Range request failed: HTTP ${res.status}`);
                this.onDataRange(begin, new Uint8Array(await res.arrayBuffer()));
            }
            abort() {
                try { this._tCtrl.abort(); } catch {}
                super.abort();
            }
        };
        return new Transport();
    }

    function queueProgressSync() {
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => {
            const percent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
            try {
                localStorage.setItem(`library:pdf-page:${item.id}`, String(currentPage));
            } catch {}
            onProgress?.(currentPage, totalPages);
            api.readingProgress(item.id)
                .then((progress) =>
                    api.updateProgress(item.id, {
                        ...progress,
                        current_page: currentPage,
                        total_pages: totalPages,
                        progress_percent: percent,
                    }),
                )
                .catch(() => {});
        }, 500);
    }

    function goToPage(n: number) {
        if (!pdfViewer || totalPages === 0) return;
        pdfViewer.currentPageNumber = Math.max(1, Math.min(totalPages, n));
    }
    function nextPage() {
        goToPage(currentPage + 1);
    }
    function prevPage() {
        goToPage(currentPage - 1);
    }
    function zoomIn() {
        if (!pdfViewer) return;
        const next = Math.min(400, Math.round(pdfViewer.currentScale * 100 + 10));
        pdfViewer.currentScaleValue = next / 100;
    }
    function zoomOut() {
        if (!pdfViewer) return;
        const next = Math.max(25, Math.round(pdfViewer.currentScale * 100 - 10));
        pdfViewer.currentScaleValue = next / 100;
    }
    function fitWidth() {
        if (pdfViewer) pdfViewer.currentScaleValue = "page-width";
    }
    function fitPage() {
        if (pdfViewer) pdfViewer.currentScaleValue = "page-fit";
    }
    function resetZoom() {
        if (!pdfViewer) return;
        pdfViewer.currentScaleValue = DEFAULT_SCALE / 100;
        scalePct = DEFAULT_SCALE;
    }

    function runSearch() {
        if (!eventBus) return;
        if (!searchQuery) {
            eventBus.dispatch("findbarclose", {});
            return;
        }
        // pdf.js v5 drives find via the event bus (PDFFindController has no
        // executeCommand method): type "" starts a search, "again" repeats it.
        eventBus.dispatch("find", {
            type: "",
            query: searchQuery,
            caseSensitive: false,
            entireWord: false,
            highlightAll: true,
            findPrevious: false,
        });
    }
    function findNext() {
        eventBus?.dispatch("find", {
            type: "again",
            query: searchQuery,
            caseSensitive: false,
            entireWord: false,
            highlightAll: true,
            findPrevious: false,
        });
    }
    function findPrev() {
        eventBus?.dispatch("find", {
            type: "again",
            query: searchQuery,
            caseSensitive: false,
            entireWord: false,
            highlightAll: true,
            findPrevious: true,
        });
    }
    function onSearchInput() {
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(runSearch, 300);
    }

    function flattenOutline(entries: any[], depth: number, out: { title: string; dest: any; depth: number }[]) {
        for (const entry of entries || []) {
            out.push({
                title: String(entry?.title || "Untitled section").trim() || "Untitled section",
                dest: entry?.dest ?? null,
                depth,
            });
            if (entry?.items?.length) flattenOutline(entry.items, depth + 1, out);
        }
        return out;
    }

    async function goToOutlineEntry(dest: any) {
        if (!dest || !linkService) return;
        try {
            await linkService.goToDestination(dest);
            showToc = false;
        } catch {}
    }

    function onKey(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null;
        if (target?.matches("input, select, textarea, [contenteditable='true']")) return;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            nextPage();
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            prevPage();
        } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            zoomIn();
        } else if (e.key === "-") {
            e.preventDefault();
            zoomOut();
        } else if (e.key === "0") {
            e.preventDefault();
            resetZoom();
        } else if (e.key.toLowerCase() === "t" && !loading) {
            e.preventDefault();
            showToc = !showToc;
        }
    }

    onMount(async () => {
        window.addEventListener("keydown", onKey);
        const appSettings = await api.settings().catch(() => null);
        scalePct = appSettings?.reading_preferences?.pdfZoom ?? loadReaderPreferences().pdfZoom;
        if (!container || !viewerEl) return;
        try {
            const pdfjsLib = await import("pdfjs-dist");
            // pdf_viewer.mjs is a webpack bundle that reads its pdf.js
            // symbols from `globalThis.pdfjsLib`, so it must be set before
            // the viewer module is evaluated.
            (globalThis as any).pdfjsLib = pdfjsLib;
            const viewerLib = await import("pdfjs-dist/web/pdf_viewer.mjs");
            await import("pdfjs-dist/web/pdf_viewer.css");
            if (!mounted || !container || !viewerEl) return;
            pdfjs = pdfjsLib;
            viewerMod = viewerLib;
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

            eventBus = new viewerMod.EventBus();
            linkService = new viewerMod.PDFLinkService({
                eventBus,
                externalLinkTarget: 2,
                externalLinkRel: "noopener",
            });
            findController = new viewerMod.PDFFindController({ eventBus, linkService });

            let pendingStartPage = 1;

            pdfViewer = new viewerMod.PDFViewer({
                container,
                viewer: viewerEl,
                eventBus,
                linkService,
                findController,
                annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
            });
            linkService.setViewer(pdfViewer);
            findController.onIsPageVisible = (pageNumber: number) =>
                pdfViewer._getVisiblePages().ids.has(pageNumber);

            eventBus.on("pagesinit", () => {
                if (!mounted) return;
                pdfViewer.currentScaleValue = DEFAULT_SCALE / 100;
                // Pages are only navigable after init; seeking earlier is
                // rejected by PDFViewer, so restore the position here.
                if (pendingStartPage > 1 && pendingStartPage <= pdfViewer.pagesCount) {
                    pdfViewer.currentPageNumber = pendingStartPage;
                }
            });
            eventBus.on("pagechanging", (e: { pageNumber?: number }) => {
                if (!mounted || typeof e?.pageNumber !== "number") return;
                currentPage = e.pageNumber;
                queueProgressSync();
            });
            eventBus.on("scalechanging", (e: { scale?: number }) => {
                if (!mounted || typeof e?.scale !== "number") return;
                scalePct = Math.round(e.scale * 100);
            });
            const onMatches = (e: { matchesCount?: { current?: number; total?: number } }) => {
                if (!mounted) return;
                matchCurrent = e?.matchesCount?.current ?? 0;
                matchTotal = e?.matchesCount?.total ?? 0;
            };
            eventBus.on("updatefindmatchescount", onMatches);
            eventBus.on("updatefindcontrolstate", onMatches);

            // Restore position: localStorage first, then server progress.
            let startPage = 1;
            try {
                const saved = parseInt(localStorage.getItem(`library:pdf-page:${item.id}`) || "", 10);
                if (Number.isFinite(saved) && saved > 0) startPage = saved;
            } catch {}
            try {
                const progress = await api.readingProgress(item.id);
                if (startPage <= 1 && progress?.current_page > 0) startPage = progress.current_page;
            } catch {}

            const fileUrl = `/api/file/${item.id}`;
            // Open through a custom range transport: pdf.js otherwise starts
            // every document with a full GET (to probe range support) that
            // races the range requests and, on large files, downloads tens of
            // MB before first paint. Only the bytes the worker asks for are
            // fetched instead.
            let transport: any = null;
            try {
                // Single probe: the Content-Range of the first chunk reveals
                // the total length, so no separate HEAD round-trip is needed.
                const first = await fetch(fileUrl, { headers: { Range: "bytes=0-131071" } });
                const total = /\/(\d+)\s*$/.exec(first.headers.get("content-range") || "");
                const length = total ? parseInt(total[1], 10) : NaN;
                if (first.status === 206 && Number.isFinite(length) && length > 0) {
                    const initialData = new Uint8Array(await first.arrayBuffer());
                    transport = createRangeTransport(pdfjs.PDFDataRangeTransport, fileUrl, length, initialData);
                }
            } catch {
                transport = null;
            }
            if (!mounted) return;
            const docParams = {
                // Large blocks: the worker rounds its range requests to this
                // granularity, so a big file opens in a handful of round-trips
                // (pdf.js defaults to 64KB, i.e. hundreds of requests).
                rangeChunkSize: 64 * 1024 * 1024,
                // No background full-file crawl; pages load on demand.
                disableAutoFetch: true,
                withCredentials: false,
            };
            loadingTask = transport
                ? pdfjs.getDocument({ ...docParams, range: transport })
                : pdfjs.getDocument({
                      ...docParams,
                      url: fileUrl,
                      disableStream: true,
                  });
            pdfDoc = await loadingTask.promise;
            if (!mounted) return;
            totalPages = pdfDoc.numPages;
            pendingStartPage = startPage > 1 && startPage <= totalPages ? startPage : 1;
            pdfViewer.setDocument(pdfDoc);
            linkService.setDocument(pdfDoc, null);
            findController.setDocument(pdfDoc);
            try {
                outline = flattenOutline(await pdfDoc.getOutline(), 0, []);
            } catch {
                outline = [];
            }
            loading = false;
            onReady?.(totalPages);
            queueProgressSync();
        } catch (e) {
            if (!mounted) return;
            loading = false;
            error = e instanceof Error ? e.message : "Unable to load this PDF.";
        }
    });

    onDestroy(() => {
        mounted = false;
        window.removeEventListener("keydown", onKey);
        if (progressTimer) clearTimeout(progressTimer);
        if (searchDebounce) clearTimeout(searchDebounce);
        try {
            pdfViewer?.setDocument(null);
            linkService?.setDocument(null);
        } catch {}
        try {
            pdfDoc?.destroy();
        } catch {}
        try {
            loadingTask?.destroy();
        } catch {}
        pdfViewer?.cleanup?.();
    });
</script>

<div class="flex flex-col h-full min-h-0 bg-surface-0">
    <!-- PDF toolbar -->
    <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-surface-1 shrink-0 text-xs">
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors disabled:opacity-30"
            title="Previous page (←)"
            aria-label="Previous PDF page"
            disabled={loading || currentPage <= 1}
            onclick={prevPage}
        >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div class="flex items-center gap-1 shrink-0">
            <input
                class="w-12 px-1.5 py-1 text-center bg-surface-2 border border-border rounded outline-none tabular-nums"
                type="number"
                min="1"
                max={totalPages || 1}
                value={currentPage}
                aria-label="PDF page number"
                onchange={(e) => goToPage(parseInt(e.currentTarget.value, 10) || 1)}
            />
            <span class="text-text-muted tabular-nums">/ {totalPages || "…"}</span>
        </div>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors disabled:opacity-30"
            title="Next page (→)"
            aria-label="Next PDF page"
            disabled={loading || (totalPages > 0 && currentPage >= totalPages)}
            onclick={nextPage}
        >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg>
        </button>

        <div class="w-px h-5 bg-border mx-1 shrink-0"></div>

        <button class="w-7 h-7 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" title="Zoom out (−)" aria-label="Zoom out" disabled={loading} onclick={zoomOut}>−</button>
        <span class="w-12 text-center text-text-secondary tabular-nums">{scalePct}%</span>
        <button class="w-7 h-7 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" title="Zoom in (+)" aria-label="Zoom in" disabled={loading} onclick={zoomIn}>+</button>
        <button class="px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30 tabular-nums" title="Reset zoom to 120% (0)" disabled={loading} onclick={resetZoom}>120</button>
        <button class="px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" title="Fit to width" disabled={loading} onclick={fitWidth}>Width</button>
        <button class="px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" title="Fit whole page" disabled={loading} onclick={fitPage}>Page</button>

        <div class="w-px h-5 bg-border mx-1 shrink-0"></div>

        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0"
            class:bg-surface-3={showToc}
            title="Contents (T)"
            aria-label="Table of contents"
            disabled={loading}
            onclick={() => (showToc = !showToc)}
        >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
        </button>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors"
            class:bg-surface-3={showSearch}
            title="Search in document"
            aria-label="Search in PDF"
            onclick={() => (showSearch = !showSearch)}
        >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
        </button>
        {#if showSearch}
            <input
                class="flex-1 min-w-24 px-2 py-1 bg-surface-2 border border-border rounded outline-none"
                type="search"
                placeholder="Search…"
                aria-label="Search PDF text"
                bind:value={searchQuery}
                oninput={onSearchInput}
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.shiftKey) findPrev();
                        else if (matchTotal > 0) findNext();
                        else runSearch();
                    }
                }}
            />
            {#if matchTotal > 0}
                <span class="text-text-muted tabular-nums shrink-0">{matchCurrent}/{matchTotal}</span>
                <button class="p-1 rounded hover:bg-surface-3" title="Previous match (Shift+Enter)" aria-label="Previous match" onclick={findPrev}>↑</button>
                <button class="p-1 rounded hover:bg-surface-3" title="Next match (Enter)" aria-label="Next match" onclick={findNext}>↓</button>
            {/if}
        {/if}
    </div>

    <!-- Virtualized page viewport (pdf.js requires absolute positioning) -->
    <div class="flex-1 min-h-0 relative bg-surface-0">
        {#if showToc}
            <aside class="absolute top-0 bottom-0 left-0 z-30 w-80 max-w-[88vw] border-r border-border bg-surface-1 shadow-2xl flex flex-col">
                <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                    <div>
                        <div class="text-sm font-medium">Contents</div>
                        <div class="text-[10px] text-text-muted">{outline.length} sections</div>
                    </div>
                    <button class="p-1.5 rounded hover:bg-surface-3" aria-label="Close contents" title="Close" onclick={() => (showToc = false)}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>
                <div class="overflow-y-auto p-2">
                    {#if outline.length === 0}
                        <div class="p-4 text-xs text-text-muted">This document does not provide a table of contents.</div>
                    {:else}
                        {#each outline as entry}
                            {#if entry.dest}
                                <button
                                    class="w-full text-left px-3 py-2 rounded text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors truncate"
                                    style="padding-left: {0.75 + entry.depth * 1}rem"
                                    title={entry.title}
                                    onclick={() => goToOutlineEntry(entry.dest)}>{entry.title}</button>
                            {:else}
                                <div class="px-3 py-2 text-xs text-text-muted truncate" style="padding-left: {0.75 + entry.depth * 1}rem" title={entry.title}>{entry.title}</div>
                            {/if}
                        {/each}
                    {/if}
                </div>
            </aside>
        {/if}
        {#if error}
            <div class="absolute inset-0 flex flex-col items-center justify-center text-error text-sm p-8 text-center gap-2">
                <div>Unable to load this PDF.</div>
                <div class="text-xs text-text-muted max-w-md">{error}</div>
            </div>
        {:else if loading}
            <div class="absolute inset-0 flex items-center justify-center text-text-muted text-sm pointer-events-none">Loading PDF…</div>
        {/if}
        <div bind:this={container} class="absolute inset-0 overflow-auto">
            <div bind:this={viewerEl} class="pdfViewer"></div>
        </div>
    </div>
</div>

<style>
    /* Skip rendering off-screen pages: opening a 300+ page document builds
       hundreds of page containers up front; without this the browser lays
       out and paints all of them before first paint. pdf.js sets explicit
       page sizes, so no intrinsic-size guess is needed. */
    :global(.pdfViewer .page) {
        content-visibility: auto;
    }
</style>
