<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { api } from "$lib/api";
    import PdfReader from "$lib/components/PdfReader.svelte";
    import { releaseEpub, warmEpub } from "$lib/epubCache";
    import { openWithRenditionFallback, type EpubRenditionMethod } from "$lib/epubRendition";
    import {
        CONTENT_WIDTHS,
        DEFAULT_READER_PREFERENCES,
        FONT_SIZES,
        LINE_HEIGHTS,
        loadReaderPreferences,
        saveReaderPreferences,
    } from "$lib/readerPreferences";

    let {
        item,
        onClose,
        onFinished,
    }: {
        item: { id: number; title: string; filename: string };
        onClose: () => void;
        onFinished?: () => void;
    } = $props();
    let isPdf = $derived(item.filename.toLowerCase().endsWith(".pdf"));

    let viewer = $state<HTMLDivElement>();
    let rendition: any = null;
    let book: any = null;
    let ready = $state(false);
    let loading = $state(true);
    let error = $state("");
    let currentPercent = $state(0);
    let currentCfi = $state("");
    let currentChapter = $state("");
    let showSettings = $state(false);
    let showPanel = $state<"contents" | "bookmarks" | null>(null);
    let navigating = $state(false);
    let focusMode = $state(false);
    let contents = $state<{ label: string; href: string }[]>([]);
    let bookmarks = $state<{ cfi: string; label: string; percent: number }[]>([]);
    let resizeObserver: ResizeObserver | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;
    let sessionStarted = false;
    let sessionStart: Promise<unknown> = Promise.resolve();
    let loadingStage = $state("Opening book…");
    // Bumped on every reader change so a screenshot of the error text
    // identifies exactly which build produced it.
    const READER_BUILD = "epub-trace-7";
    // Milestones reached during open; appended to any error so a failure
    // can be localized (parse vs iframe-load vs layout) from a screenshot.
    let trace: string[] = [];
    let traceT0 = 0;
    function report(event: string, detail: Record<string, unknown> = {}) {
        void api.epubDiagnostic({
            event,
            item_id: item.id,
            build: READER_BUILD,
            elapsed_ms: traceT0 ? Math.round(performance.now() - traceT0) : 0,
            user_agent: navigator.userAgent,
            ...detail,
        }).catch(() => {});
    }
    function note(step: string) {
        if (!traceT0) traceT0 = performance.now();
        trace.push(`${step}@${Math.round(performance.now() - traceT0)}ms`);
        report("milestone", { step });
    }
    function fail(message: string) {
        error = `${message} [trace: ${trace.join("→") || "none"}] [build ${READER_BUILD}]`;
        report("failure", { message, trace });
    }

    function renditionDomState(viewerElement: HTMLDivElement) {
        const frames = [...viewerElement.querySelectorAll("iframe")];
        return {
            viewer_children: viewerElement.children.length,
            iframe_count: frames.length,
            frames: frames.map((frame) => {
                try {
                    return {
                        src: frame.getAttribute("src") || "",
                        srcdoc_length: frame.srcdoc?.length || 0,
                        ready_state: frame.contentDocument?.readyState || "none",
                        body_length: frame.contentDocument?.body?.textContent?.length || 0,
                    };
                } catch {
                    return { src: frame.getAttribute("src") || "", access: "blocked" };
                }
            }),
        };
    }

    // Load one minimal chapter through each iframe method the library
    // supports and report which ones fire onload in THIS engine. Used only
    // for diagnosis: the desktop webview hangs where desktop Chromium does
    // not, and a screenshot of the result identifies the working method.
    async function probeIframeMethods(): Promise<string> {
        const html = "<!DOCTYPE html><html><head></head><body>probe</body></html>";
        const results: string[] = [];
        const attempt = (name: string, load: (frame: HTMLIFrameElement) => void): Promise<void> =>
            new Promise((resolve) => {
                let done = false;
                const finish = (outcome: string) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    try { frame.remove(); } catch {}
                    results.push(`${name}=${outcome}`);
                    resolve();
                };
                const frame = document.createElement("iframe");
                frame.style.cssText = "position:absolute;width:10px;height:10px;visibility:hidden";
                const timer = setTimeout(() => {
                    try {
                        const state = frame.contentDocument?.readyState || "none";
                        const hasBody = !!frame.contentDocument?.body?.textContent;
                        finish(`timeout-${state}-${hasBody ? "content" : "empty"}`);
                    } catch {
                        finish("timeout-blocked");
                    }
                }, 4000);
                frame.onload = () => {
                    try {
                        const ok = !!frame.contentDocument?.body;
                        finish(ok ? "ok" : "empty");
                    } catch {
                        finish("blocked");
                    }
                };
                frame.onerror = () => finish("error");
                document.body.appendChild(frame);
                try {
                    load(frame);
                } catch {
                    finish("threw");
                }
            });
        await attempt("write", (frame) => {
            const doc = frame.contentDocument;
            if (!doc) throw new Error("no document");
            doc.open();
            doc.write(html);
            doc.close();
        });
        await attempt("srcdoc", (frame) => {
            frame.srcdoc = html;
        });
        await attempt("blobUrl", (frame) => {
            frame.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        });
        const features = [
            `RO=${typeof ResizeObserver}`,
            `BLOB=${typeof Blob}:${typeof URL?.createObjectURL}`,
        ].join(" ");
        return `${results.join(" ")} ${features}`;
    }

    // Race any epub-js promise against a timeout: some failures (e.g. a
    // stale saved position, or an iframe load that never fires in some
    // webviews) never settle, which used to leave "Loading EPUB…" on screen
    // forever. A timeout converts those into an actionable error instead.
    function withTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${stage} timed out`)), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
    let pdfTotal = $state(0);
    let pdfPage = $state(1);
    let finishSent = false;

    function maybeFinishReading() {
        if (finishSent || currentPercent < 100) return;
        finishSent = true;
        void api.finishReading(item.id).then(() => onFinished?.()).catch(() => {
            finishSent = false;
        });
    }

    function handlePdfReady(total: number) {
        if (!mounted) return;
        pdfTotal = total;
        ready = true;
        loading = false;
    }
    function handlePdfProgress(page: number, total: number) {
        if (!mounted) return;
        pdfPage = page;
        pdfTotal = total;
        currentPercent = total > 0 ? Math.round((page / total) * 100) : 0;
        currentChapter = total > 0 ? `Page ${page} / ${total}` : "";
        ready = true;
        maybeFinishReading();
    }

    // ── Reader settings (persisted in localStorage) ──────────────────────
    const FONT_FAMILIES: Record<string, string> = {
        default: "'IBM Plex Serif', Georgia, 'Times New Roman', serif",
        serif: "'IBM Plex Serif', Georgia, 'Times New Roman', serif",
        sans: "'IBM Plex Sans', Inter, ui-sans-serif, system-ui, sans-serif",
        mono: "'JetBrains Mono', 'Courier New', monospace",
    };
    const THEMES: Record<string, { bg: string; fg: string }> = {
        light: { bg: "#ffffff", fg: "#1a1a1a" },
        sepia: { bg: "#f4ecd8", fg: "#5b4636" },
        dark: { bg: "#1e1e1e", fg: "#d4d4d4" },
        black: { bg: "#090909", fg: "#e2e2e2" },
    };

    let settings = $state({ ...DEFAULT_READER_PREFERENCES });

    // Load saved settings once on mount (NOT in $effect — that would
    // read + write `settings` in the same effect → infinite loop).
    async function loadSettings() {
        try {
            const appSettings = await api.settings();
            settings = appSettings.reading_preferences || loadReaderPreferences();
            const savedBookmarks = localStorage.getItem(`library:epub-bookmarks:${item.id}`);
            if (savedBookmarks) bookmarks = JSON.parse(savedBookmarks);
        } catch {
            settings = loadReaderPreferences();
        }
    }

    function saveSettings() {
        try { saveReaderPreferences(settings); } catch {}
        void api.updateReadingPreferences(settings).catch(() => {});
    }

    // ── Settings actions ─────────────────────────────────────────────────
    function changeFontSize(delta: number) {
        const idx = FONT_SIZES.indexOf(settings.fontSize);
        const nextIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta));
        settings.fontSize = FONT_SIZES[nextIdx];
        applyFontSize();
        saveSettings();
    }

    function changeFontFamily(fam: string) {
        settings.fontFamily = fam as typeof settings.fontFamily;
        applyFontFamily();
        saveSettings();
    }

    function changeLineHeight(delta: number) {
        const idx = LINE_HEIGHTS.indexOf(settings.lineHeight);
        const nextIdx = Math.max(0, Math.min(LINE_HEIGHTS.length - 1, idx + delta));
        settings.lineHeight = LINE_HEIGHTS[nextIdx];
        applyTypography();
        saveSettings();
    }

    function changeContentWidth(delta: number) {
        const idx = CONTENT_WIDTHS.indexOf(settings.contentWidth);
        const nextIdx = Math.max(0, Math.min(CONTENT_WIDTHS.length - 1, idx + delta));
        settings.contentWidth = CONTENT_WIDTHS[nextIdx];
        applyTypography();
        saveSettings();
    }

    function changeTheme(theme: string) {
        settings.theme = theme as typeof settings.theme;
        applyTheme();
        saveSettings();
    }

    function toggleSpread() {
        settings.spread = settings.spread === "none" ? "both" : "none";
        applySpread();
        saveSettings();
    }

    function toggleFlow() {
        settings.flow = settings.flow === "paginated" ? "scrolled" : "paginated";
        applyFlow();
        saveSettings();
    }

    function togglePanel(panel: "contents" | "bookmarks") {
        // PDFs have their own toolbar/panels inside PdfReader.
        if (isPdf) return;
        showSettings = false;
        showPanel = showPanel === panel ? null : panel;
    }

    function toggleFocusMode() {
        focusMode = !focusMode;
        if (focusMode) {
            showSettings = false;
            showPanel = null;
        }
    }

    function saveBookmarks() {
        try { localStorage.setItem(`library:epub-bookmarks:${item.id}`, JSON.stringify(bookmarks)); } catch {}
    }

    function toggleBookmark() {
        if (!currentCfi) return;
        const existing = bookmarks.findIndex((bookmark) => bookmark.cfi === currentCfi);
        if (existing >= 0) bookmarks.splice(existing, 1);
        else bookmarks.unshift({ cfi: currentCfi, label: currentChapter || `Page ${currentPercent}%`, percent: currentPercent });
        bookmarks = [...bookmarks];
        saveBookmarks();
    }

    function isBookmarked() {
        return bookmarks.some((bookmark) => bookmark.cfi === currentCfi);
    }

    async function displayLocation(target: string) {
        if (!rendition || navigating) return;
        navigating = true;
        try {
            await rendition.display(target);
            showPanel = null;
        } finally {
            navigating = false;
        }
    }

    function removeBookmark(cfi: string) {
        bookmarks = bookmarks.filter((bookmark) => bookmark.cfi !== cfi);
        saveBookmarks();
    }

    function savePosition() {
        if (!currentCfi) return;
        try { localStorage.setItem(`library:epub-position:${item.id}`, currentCfi); } catch {}
    }

    function queueProgressSync() {
        savePosition();
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = setTimeout(() => {
            api.readingProgress(item.id).then((progress) => api.updateProgress(item.id, {
                ...progress,
                progress_percent: currentPercent,
            })).catch(() => {});
        }, 500);
    }

    // ── Apply settings to rendition ──────────────────────────────────────
    // NOTE: this @intity/epub-js fork has no themes.override() (the original
    // epubjs does). Typography is baked into the registered theme rules and
    // re-registered whenever a setting changes; select() early-returns when
    // the theme name is unchanged, so it is detached and re-attached to
    // force the fresh rules into every rendered section.
    function themeBodyRules(t: { bg: string; fg: string }) {
        const fam = FONT_FAMILIES[settings.fontFamily];
        return {
            background: t.bg,
            color: t.fg,
            "line-height": String(settings.lineHeight),
            "max-width": `${settings.contentWidth}px`,
            "margin-left": "auto",
            "margin-right": "auto",
            ...(fam ? { "font-family": `${fam} !important` } : {}),
        };
    }
    function registerAllThemes() {
        if (!rendition) return;
        for (const [name, t] of Object.entries(THEMES)) {
            rendition.themes.register(name, {
                body: themeBodyRules(t),
                p: { color: `${t.fg} !important`, "line-height": String(settings.lineHeight) },
                a: { color: `${t.fg} !important` },
            });
        }
    }
    function reselectTheme() {
        if (!rendition) return;
        rendition.themes.select(null);
        rendition.themes.select(settings.theme);
    }
    function applyFontSize() {
        rendition?.themes.fontSize(`${settings.fontSize}%`);
    }
    function applyFontFamily() {
        registerAllThemes();
        reselectTheme();
    }
    function applyTypography() {
        registerAllThemes();
        reselectTheme();
    }
    function applyTheme() {
        rendition?.themes.select(settings.theme);
        // Update the viewer background to match
        const t = THEMES[settings.theme];
        if (viewer) viewer.style.background = t.bg;
    }
    function applySpread() {
        rendition?.spread(settings.spread);
    }
    function applyFlow() {
        rendition?.flow(settings.flow);
    }

    // ── Navigation ───────────────────────────────────────────────────────
    async function next() {
        if (!rendition || navigating) return;
        navigating = true;
        try {
            await rendition.next();
        } finally {
            navigating = false;
        }
    }
    async function prev() {
        if (!rendition || navigating) return;
        navigating = true;
        try {
            await rendition.prev();
        } finally {
            navigating = false;
        }
    }

    function onKey(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null;
        if (target?.matches("input, select, textarea, [contenteditable='true']")) return;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            next();
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            prev();
        }
        if (e.key === "Escape") {
            if (showSettings || showPanel) {
                showSettings = false;
                showPanel = null;
            } else if (focusMode) {
                focusMode = false;
            } else {
                onClose();
            }
        }
        if (e.key.toLowerCase() === "b" && ready) toggleBookmark();
        if (e.key.toLowerCase() === "t" && ready) { e.preventDefault(); togglePanel("contents"); }
        if (e.key.toLowerCase() === "f" && ready) { e.preventDefault(); toggleFocusMode(); }
        if (e.key.toLowerCase() === "b" && ready) e.preventDefault();
        if (e.key === "+" || e.key === "=") { e.preventDefault(); changeFontSize(1); }
        if (e.key === "-") { e.preventDefault(); changeFontSize(-1); }
    }

    onMount(async () => {
        window.addEventListener("keydown", onKey);
        await loadSettings();
        report("reader-mounted", {
            origin: location.origin,
            secure_context: isSecureContext,
            cross_origin_isolated: crossOriginIsolated,
        });
        sessionStart = api.startReading(item.id).then(() => {
            sessionStarted = true;
        }).catch(() => {});
        if (!viewer) return;
        const viewerElement = viewer;
        if (isPdf) {
            loading = false;
            return;
        }

        try {
            // Reuse the package warmed by the detail panel. This moves the
            // archive download and ZIP parse before the user presses Read.
            const warmed = await warmEpub(item.id);
            book = warmed.book;
            loadingStage = "Opening book…";
            await withTimeout(book.loaded.sections, 30000, "Loading EPUB spine");
            note("spine-ready");

            book.on("openFailed", (cause: unknown) => {
                if (mounted) {
                    loading = false;
                    fail(cause instanceof Error ? cause.message : "Unable to open this EPUB archive.");
                }
            });
            // Stage markers inside the library's own pipeline: section hooks
            // fire during Section.load/render, rendition hooks after the
            // chapter iframe loads. The last marker in a failure trace is
            // the call that never returned.
            try {
                book.sections.hooks?.content?.register(() => {
                    note("section-content");
                });
                book.sections.hooks?.serialize?.register(() => {
                    note("serialize");
                });
            } catch {}
            loadingStage = "Loading first chapter…";
            const firstSection = book.sections.get(0);
            if (!firstSection) throw new Error("This EPUB has no readable chapters.");
            let rawSaved = "";
            try { rawSaved = localStorage.getItem(`library:epub-position:${item.id}`) || ""; } catch {}
            // Only well-formed CFIs are worth attempting; anything else goes
            // straight to the first page instead of erroring or hanging.
            let savedPosition = rawSaved.indexOf("epubcfi(") === 0 ? rawSaved : "";
            const opened = await openWithRenditionFallback({
                timeoutMs: 6000,
                onAttempt: ({ method, phase, elapsedMs, error: attemptError }) => {
                    report("rendition-attempt", {
                        method,
                        phase,
                        elapsed_ms: elapsedMs,
                        ...(attemptError ? { attempt_error: attemptError } : {}),
                        ...(phase === "timeout" || phase === "failure"
                            ? renditionDomState(viewerElement)
                            : {}),
                    });
                },
                create: (method: EpubRenditionMethod) => {
                    viewerElement.replaceChildren();
                    const candidate = book.renderTo(viewerElement, {
                        width: "100%",
                        height: "100%",
                        method,
                        spread: settings.spread,
                        flow: settings.flow,
                    });
                    rendition = candidate;
                    registerAllThemes();
                    candidate.themes.select(settings.theme);
                    candidate.on("relocated", (location: any) => {
                        if (!mounted || rendition !== candidate) return;
                        note("relocated");
                        if (location?.percentage) currentPercent = Math.round(location.percentage * 100);
                        currentCfi = location?.start?.cfi || "";
                        currentChapter = location?.start?.href?.split("#")[0]?.split("/").pop()?.replace(/\.(xhtml|html?)$/i, "") || "";
                        maybeFinishReading();
                        queueProgressSync();
                    });
                    candidate.on("rendered", () => {
                        if (mounted && rendition === candidate) note("rendered");
                    });
                    try { candidate.hooks.content.register(() => note("rendition-content")); } catch {}
                    return candidate;
                },
                display: async (candidate, method) => {
                    loadingStage = savedPosition ? "Restoring position…" : "Opening first page…";
                    try {
                        await candidate.display(savedPosition || 0);
                    } catch (error) {
                        if (savedPosition) {
                            savedPosition = "";
                            try { localStorage.removeItem(`library:epub-position:${item.id}`); } catch {}
                        }
                        throw error;
                    }
                    note(`opened:${method}`);
                },
                dispose: (candidate) => {
                    try { candidate.destroy(); } catch {}
                    if (rendition === candidate) rendition = null;
                },
            });
            rendition = opened.rendition;
            // NOTE: this @intity/epub-js fork has no book.ready promise
            // (the original epubjs does) — navigation is awaited explicitly.
            book.loaded.navigation.then(() => {
                if (!mounted) return;
                contents = (book.navigation?.toc || []).flatMap((entry: any) => [
                    { label: entry.label?.trim() || "Untitled section", href: entry.href },
                    ...(entry.subitems || []).map((subitem: any) => ({
                        label: `  ${subitem.label?.trim() || "Untitled section"}`,
                        href: subitem.href,
                    })),
                ]);
            }).catch(() => {});
            if (!mounted) return;
            ready = true;
            loading = false;

            // Apply font settings after display
            applyFontSize();
            applyTypography();

            // Set viewer background
            const t = THEMES[settings.theme];
            viewer.style.background = t.bg;

        } catch (e) {
            loading = false;
            // If we never got past displaying, find out which iframe load
            // methods this engine supports so the next build can use one.
            if (!trace.includes("relocated") && !trace.includes("rendered")) {
                loadingStage = "Diagnosing engine…";
                try {
                    const probe = await probeIframeMethods();
                    trace.push(`probe:${probe}`);
                } catch {
                    trace.push("probe:failed");
                }
            }
            fail(e instanceof Error ? e.message : "Unable to load this EPUB.");
        }

        resizeObserver = new ResizeObserver(() => {
            rendition?.resize(viewer?.clientWidth, viewer?.clientHeight);
        });
        resizeObserver.observe(viewer);
    });

    onDestroy(() => {
        mounted = false;
        window.removeEventListener("keydown", onKey);
        if (progressTimer) clearTimeout(progressTimer);
        resizeObserver?.disconnect();
        rendition?.destroy();
        releaseEpub(item.id);
        if (sessionStarted) {
            void api.stopReading(item.id).catch(() => {});
        } else {
            void sessionStart.then(() => api.stopReading(item.id)).catch(() => {});
        }
    });
</script>

<div class="fixed inset-0 bg-surface-0 z-40 flex flex-col" role="dialog" aria-label={isPdf ? "PDF reader" : "EPUB reader"}>
    {#if !focusMode}
    <!-- Reader header -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-1 shrink-0">
        <button class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0" title="Close (Esc)" aria-label="Close reader" onclick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">{item.title}</div>
            {#if ready}<div class="text-[10px] text-text-muted truncate">{currentChapter || `${currentPercent}% read`}</div>{/if}
        </div>

        {#if !isPdf}
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0"
            class:bg-surface-3={showPanel === "contents"}
            title="Contents (T)"
            aria-label="Table of contents"
            onclick={() => togglePanel("contents")}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
        </button>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0"
            class:bg-surface-3={showPanel === "bookmarks" || isBookmarked()}
            class:text-accent={isBookmarked()}
            title="Bookmark (B)"
            aria-label={isBookmarked() ? "Remove bookmark" : "Add bookmark"}
            onclick={toggleBookmark}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill={isBookmarked() ? "currentColor" : "none"} stroke="currentColor" stroke-width="2"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-3-6 3V4z" /></svg>
        </button>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0"
            class:bg-surface-3={focusMode}
            title="Focus mode (F)"
            aria-label="Toggle focus mode"
            onclick={toggleFocusMode}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
        </button>
        {/if}

        <div class="w-px h-5 bg-border mx-1 shrink-0"></div>

        <!-- Settings gear -->
        {#if !isPdf}
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0"
            class:bg-surface-3={showSettings}
            title="Settings"
            aria-label="Reader settings"
            onclick={() => (showSettings = !showSettings)}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                ><circle cx="12" cy="12" r="3" /><path
                    d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
        </button>
        {/if}

        <div class="w-px h-5 bg-border mx-1 shrink-0"></div>

        {#if !isPdf}
        <button class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-30" title="Previous (←)" aria-label="Previous page" disabled={!ready || navigating} onclick={prev}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                ><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button class="p-1.5 rounded hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-30" title="Next (→)" aria-label="Next page" disabled={!ready || navigating} onclick={next}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                ><polyline points="9 18 15 12 9 6" /></svg>
        </button>
        {/if}
    </div>

    <!-- Settings panel (collapsible) -->
    {#if showSettings}
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 border-b border-border bg-surface-1 shrink-0 text-xs">
            <!-- Font size -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Font</span>
                <button class="w-6 h-6 flex items-center justify-center rounded bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-30"
                    onclick={() => changeFontSize(-1)} disabled={settings.fontSize === FONT_SIZES[0]} title="Smaller font">A<span class="text-[8px]">−</span></button>
                <span class="w-10 text-center text-text-secondary tabular-nums">{settings.fontSize}%</span>
                <button class="w-6 h-6 flex items-center justify-center rounded bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-30"
                    onclick={() => changeFontSize(1)} disabled={settings.fontSize === FONT_SIZES[FONT_SIZES.length - 1]} title="Larger font">A<span class="text-[10px]">+</span></button>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <!-- Font family -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Face</span>
                <select class="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary outline-none cursor-pointer hover:bg-surface-3 transition-colors"
                    value={settings.fontFamily} onchange={(e) => changeFontFamily(e.currentTarget.value)}>
                    <option value="default">Default</option>
                    <option value="serif">Serif</option>
                    <option value="sans">Sans-serif</option>
                    <option value="mono">Monospace</option>
                </select>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <!-- Reading rhythm -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Line</span>
                <button class="w-6 h-6 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" onclick={() => changeLineHeight(-1)} disabled={settings.lineHeight === LINE_HEIGHTS[0]} title="Tighter line spacing">−</button>
                <span class="w-8 text-center text-text-secondary tabular-nums">{settings.lineHeight}</span>
                <button class="w-6 h-6 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" onclick={() => changeLineHeight(1)} disabled={settings.lineHeight === LINE_HEIGHTS[LINE_HEIGHTS.length - 1]} title="Looser line spacing">+</button>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Width</span>
                <button class="w-6 h-6 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" onclick={() => changeContentWidth(-1)} disabled={settings.contentWidth === CONTENT_WIDTHS[0]} title="Narrower text column">−</button>
                <span class="w-10 text-center text-text-secondary tabular-nums">{settings.contentWidth}</span>
                <button class="w-6 h-6 rounded bg-surface-2 hover:bg-surface-3 disabled:opacity-30" onclick={() => changeContentWidth(1)} disabled={settings.contentWidth === CONTENT_WIDTHS[CONTENT_WIDTHS.length - 1]} title="Wider text column">+</button>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <!-- Theme -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Theme</span>
                <div class="flex gap-1">
                    {#each Object.entries(THEMES) as [name, t]}
                        <button class="w-6 h-6 rounded border-2 transition-transform hover:scale-110"
                            style="background: {t.bg}; border-color: {settings.theme === name ? 'var(--color-accent)' : 'transparent'}"
                            title={name.charAt(0).toUpperCase() + name.slice(1)}
                            onclick={() => changeTheme(name)}></button>
                    {/each}
                </div>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <!-- Layout: single / double page -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Pages</span>
                <div class="flex bg-surface-2 rounded border border-border overflow-hidden">
                    <button class="px-2 py-1 transition-colors"
                        class:bg-accent={settings.spread === "none"} class:text-white={settings.spread === "none"} class:text-text-secondary={settings.spread !== "none"}
                        onclick={() => { if (settings.spread !== "none") toggleSpread(); }} title="Single page">1</button>
                    <button class="px-2 py-1 transition-colors"
                        class:bg-accent={settings.spread === "both"} class:text-white={settings.spread === "both"} class:text-text-secondary={settings.spread !== "both"}
                        onclick={() => { if (settings.spread !== "both") toggleSpread(); }} title="Two pages">2</button>
                </div>
            </div>

            <div class="w-px h-5 bg-border shrink-0"></div>

            <!-- Flow: paginated / scrolled -->
            <div class="flex items-center gap-1.5">
                <span class="text-text-muted text-[10px] uppercase tracking-wider">Scroll</span>
                <div class="flex bg-surface-2 rounded border border-border overflow-hidden">
                    <button class="px-2 py-1 transition-colors"
                        class:bg-accent={settings.flow === "paginated"} class:text-white={settings.flow === "paginated"} class:text-text-secondary={settings.flow !== "paginated"}
                        onclick={() => { if (settings.flow !== "paginated") toggleFlow(); }} title="Paginated">Pages</button>
                    <button class="px-2 py-1 transition-colors"
                        class:bg-accent={settings.flow === "scrolled"} class:text-white={settings.flow === "scrolled"} class:text-text-secondary={settings.flow !== "scrolled"}
                        onclick={() => { if (settings.flow !== "scrolled") toggleFlow(); }} title="Continuous scroll">Scroll</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Progress bar -->
    {#if ready}
        <div class="h-0.5 bg-surface-2 shrink-0">
            <div class="h-full bg-accent transition-all" style="width: {currentPercent}%"></div>
        </div>
    {/if}
    {/if}

    {#if showPanel && !isPdf}
        <aside class="absolute top-0 bottom-0 left-0 z-30 w-80 max-w-[88vw] border-r border-border bg-surface-1 shadow-2xl flex flex-col">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div>
                    <div class="text-sm font-medium">{showPanel === "contents" ? "Contents" : "Bookmarks"}</div>
                    <div class="text-[10px] text-text-muted">{showPanel === "contents" ? `${contents.length} sections` : `${bookmarks.length} saved`}</div>
                </div>
                <button class="p-1.5 rounded hover:bg-surface-3" aria-label="Close panel" title="Close" onclick={() => (showPanel = null)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
            <div class="overflow-y-auto p-2">
                {#if showPanel === "contents"}
                    {#if contents.length === 0}
                        <div class="p-4 text-xs text-text-muted">This book does not provide a table of contents.</div>
                    {:else}
                        {#each contents as entry}
                            <button class="w-full text-left px-3 py-2 rounded text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors truncate" title={entry.label.trim()} onclick={() => displayLocation(entry.href)}>{entry.label}</button>
                        {/each}
                    {/if}
                {:else if bookmarks.length === 0}
                    <div class="p-4 text-xs text-text-muted">Press B or use the bookmark button to save this page.</div>
                {:else}
                    {#each bookmarks as bookmark}
                        <div class="flex items-center gap-1 rounded hover:bg-surface-3 group">
                            <button class="flex-1 min-w-0 text-left px-3 py-2 text-xs text-text-secondary hover:text-text-primary truncate" onclick={() => displayLocation(bookmark.cfi)}>
                                <div class="truncate">{bookmark.label}</div>
                                <div class="text-[10px] text-text-muted">{bookmark.percent}%</div>
                            </button>
                            <button class="p-2 text-text-muted hover:text-error opacity-0 group-hover:opacity-100" title="Remove bookmark" aria-label="Remove bookmark" onclick={() => removeBookmark(bookmark.cfi)}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>
        </aside>
    {/if}

    <!-- Viewer -->
    <div class="flex-1 min-h-0 relative bg-surface-0">
        {#if isPdf}
            <div class="absolute inset-0">
                <PdfReader {item} onReady={handlePdfReady} onProgress={handlePdfProgress} />
            </div>
        {:else if error}
            <div class="flex flex-col items-center justify-center h-full text-error text-sm p-8 text-center gap-2">
                <div>Unable to load this EPUB.</div>
                <div class="text-xs text-text-muted max-w-md">{error}</div>
            </div>
        {:else if loading}
            <div class="absolute inset-0 flex flex-col gap-1 items-center justify-center text-text-muted text-sm pointer-events-none"><div>Loading EPUB…</div><div class="text-xs opacity-70">{loadingStage}</div></div>
        {/if}
        {#if !isPdf}
            <div bind:this={viewer} class="w-full h-full max-w-5xl mx-auto"></div>
        {/if}
    </div>
</div>
