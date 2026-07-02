<script lang="ts">
    import { onMount, onDestroy } from "svelte";

    let {
        item,
        onClose,
    }: {
        item: { id: number; title: string; filename: string };
        onClose: () => void;
    } = $props();

    let viewer: HTMLDivElement;
    let rendition: any = null;
    let book: any = null;
    let ready = $state(false);
    let error = $state("");
    let currentPercent = $state(0);

    function next() {
        rendition?.next();
    }
    function prev() {
        rendition?.prev();
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === "ArrowRight") next();
        if (e.key === "ArrowLeft") prev();
        if (e.key === "Escape") onClose();
    }

    onMount(async () => {
        window.addEventListener("keydown", onKey);
        if (!viewer) return;

        try {
            // Dynamic import — epub.js touches window/document, must not
            // be imported at the top level (SSR-safe + lazy-loaded).
            const ePub = (await import("epubjs")).default;
            const url = `/api/file/${item.id}`;
            book = ePub(url);
            rendition = book.renderTo(viewer, {
                width: "100%",
                height: "100%",
                spread: "none",
                flow: "paginated",
            });
            await rendition.display();
            ready = true;

            book.ready.then(() => {
                rendition.on("relocated", (location: any) => {
                    if (location?.percentage) {
                        currentPercent = Math.round(location.percentage * 100);
                    }
                });
            });
        } catch (e) {
            error = `Failed to load EPUB: ${e}`;
        }
    });

    onDestroy(() => {
        window.removeEventListener("keydown", onKey);
        rendition?.destroy();
        book?.destroy();
    });
</script>

<div class="fixed inset-0 bg-surface-0 z-40 flex flex-col">
    <!-- Reader header -->
    <div
        class="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-1 shrink-0"
    >
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors"
            title="Close (Esc)"
            onclick={onClose}
        >
            <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><line x1="18" y1="6" x2="6" y2="18" /><line
                    x1="6"
                    y1="6"
                    x2="18"
                    y2="18"
                /></svg
            >
        </button>
        <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">{item.title}</div>
            {#if ready}<div class="text-[10px] text-text-muted">
                    {currentPercent}% read
                </div>{/if}
        </div>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors"
            title="Previous"
            onclick={prev}
        >
            <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
            >
        </button>
        <button
            class="p-1.5 rounded hover:bg-surface-3 transition-colors"
            title="Next"
            onclick={next}
        >
            <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg
            >
        </button>
    </div>

    <!-- Progress bar -->
    {#if ready}
        <div class="h-0.5 bg-surface-2 shrink-0">
            <div
                class="h-full bg-accent transition-all"
                style="width: {currentPercent}%"
            ></div>
        </div>
    {/if}

    <!-- Viewer -->
    <div class="flex-1 relative">
        {#if error}
            <div
                class="flex items-center justify-center h-full text-error text-sm p-8 text-center"
            >
                {error}
            </div>
        {:else if !ready}
            <div
                class="flex items-center justify-center h-full text-text-muted text-sm"
            >
                Loading EPUB…
            </div>
        {/if}
        <div bind:this={viewer} class="w-full h-full"></div>
    </div>
</div>
