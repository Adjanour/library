<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { api } from "$lib/api";

    let {
        item,
        onClose,
    }: {
        item: { id: number; title: string; filename: string };
        onClose: () => void;
    } = $props();
    let isPdf = $derived(item.filename.toLowerCase().endsWith(".pdf"));

    let viewer: HTMLDivElement;
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

    // ── Reader settings (persisted in localStorage) ──────────────────────
    const FONT_SIZES = [80, 90, 100, 110, 125, 150, 175, 200];
    const LINE_HEIGHTS = [1.35, 1.5, 1.65, 1.8, 2];
    const CONTENT_WIDTHS = [560, 640, 720, 840, 960];
    const FONT_FAMILIES: Record<string, string> = {
        default: "",
        serif: "Georgia, 'Times New Roman', serif",
        sans: "'Helvetica Neue', Arial, sans-serif",
        mono: "'JetBrains Mono', 'Courier New', monospace",
    };
    const THEMES: Record<string, { bg: string; fg: string }> = {
        light: { bg: "#ffffff", fg: "#1a1a1a" },
        sepia: { bg: "#f4ecd8", fg: "#5b4636" },
        dark: { bg: "#1e1e1e", fg: "#d4d4d4" },
        black: { bg: "#090909", fg: "#e2e2e2" },
    };

    let settings = $state({
        fontSize: 100,
        fontFamily: "default",
        lineHeight: 1.65,
        contentWidth: 840,
        theme: "light",
        spread: "none" as "none" | "both",
        flow: "paginated" as "paginated" | "scrolled",
    });

    // Load saved settings once on mount (NOT in $effect — that would
    // read + write `settings` in the same effect → infinite loop).
    function loadSettings() {
        try {
            const saved = localStorage.getItem("library:epub-settings");
            if (saved) settings = { ...settings, ...JSON.parse(saved) };
            const savedBookmarks = localStorage.getItem(`library:epub-bookmarks:${item.id}`);
            if (savedBookmarks) bookmarks = JSON.parse(savedBookmarks);
        } catch {}
    }

    function saveSettings() {
        try {
            localStorage.setItem("library:epub-settings", JSON.stringify(settings));
        } catch {}
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
        settings.fontFamily = fam;
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
        settings.theme = theme;
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
        showSettings = false;
        showPanel = showPanel === panel ? null : panel;
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
    function applyFontSize() {
        rendition?.themes.fontSize(`${settings.fontSize}%`);
    }
    function applyFontFamily() {
        const fam = FONT_FAMILIES[settings.fontFamily];
        if (fam) rendition?.themes.font(fam);
        else rendition?.themes.override("font-family", "", true);
    }
    function applyTypography() {
        rendition?.themes.override("line-height", String(settings.lineHeight), true);
        rendition?.themes.override("max-width", `${settings.contentWidth}px`, true);
        rendition?.themes.override("margin-left", "auto", true);
        rendition?.themes.override("margin-right", "auto", true);
        applyFontFamily();
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
        if (e.key.toLowerCase() === "t" && ready) togglePanel("contents");
        if (e.key.toLowerCase() === "f" && ready) focusMode = !focusMode;
        if (e.key === "+" || e.key === "=") changeFontSize(1);
        if (e.key === "-") changeFontSize(-1);
    }

    onMount(async () => {
        window.addEventListener("keydown", onKey);
        loadSettings();
        if (!viewer) return;
        if (isPdf) {
            ready = true;
            loading = false;
            return;
        }

        try {
            // @ts-expect-error The package's browser bundle lacks a declaration file.
            const ePub = (await import("@intity/epub-js/dist/public/epub.js")).default;
            const response = await fetch(`/api/file/${item.id}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            book = ePub();
            await book.open(buffer, "binary");

            rendition = book.renderTo(viewer, {
                width: "100%",
                height: "100%",
                spread: settings.spread,
                flow: settings.flow,
            });

            // Register themes
            for (const [name, t] of Object.entries(THEMES)) {
                rendition.themes.register(name, {
                    body: { background: t.bg, color: t.fg },
                    p: { color: `${t.fg} !important` },
                    a: { color: `${t.fg} !important` },
                });
            }
            rendition.themes.select(settings.theme);

            book.on("openFailed", (cause: unknown) => {
                if (mounted) {
                    loading = false;
                    error = cause instanceof Error ? cause.message : "Unable to open this EPUB archive.";
                }
            });
            rendition.on("displayerror", (cause: unknown) => {
                if (mounted) {
                    loading = false;
                    error = cause instanceof Error ? cause.message : "Unable to render this EPUB.";
                }
            });
            rendition.on("loaderror", (cause: unknown) => {
                if (mounted) {
                    loading = false;
                    error = cause instanceof Error ? cause.message : "Unable to load this EPUB section.";
                }
            });

            rendition.on("relocated", (location: any) => {
                if (!mounted) return;
                if (location?.percentage) {
                    currentPercent = Math.round(location.percentage * 100);
                }
                currentCfi = location?.start?.cfi || "";
                currentChapter = location?.start?.href?.split("#")[0]?.split("/").pop()?.replace(/\.(xhtml|html?)$/i, "") || "";
                queueProgressSync();
            });

            await book.loaded.sections;
            const firstSection = book.sections.get(0);
            if (!firstSection) throw new Error("This EPUB has no readable chapters.");
            let savedPosition = "";
            try { savedPosition = localStorage.getItem(`library:epub-position:${item.id}`) || ""; } catch {}
            if (savedPosition) await rendition.display(savedPosition);
            else await rendition.display(0);
            book.ready.then(() => {
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
            error = e instanceof Error ? e.message : "Unable to load this EPUB.";
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
        book?.destroy();
    });
</script>

<div class="fixed inset-0 bg-surface-0 z-40 flex flex-col" role="dialog" aria-label="EPUB reader">
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
            onclick={() => (focusMode = !focusMode)}
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
            <iframe src={`/api/file/${item.id}`} class="w-full h-full border-0" title={`PDF reader: ${item.title}`}></iframe>
        {:else if error}
            <div class="flex flex-col items-center justify-center h-full text-error text-sm p-8 text-center gap-2">
                <div>Unable to load this EPUB.</div>
                <div class="text-xs text-text-muted max-w-md">{error}</div>
            </div>
        {:else if loading}
            <div class="absolute inset-0 flex items-center justify-center text-text-muted text-sm pointer-events-none">Loading EPUB…</div>
        {/if}
        <div bind:this={viewer} class="w-full h-full max-w-5xl mx-auto"></div>
    </div>
</div>
