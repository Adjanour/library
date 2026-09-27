<script lang="ts">
    import { onDestroy } from "svelte";
    import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

    let { item }: { item: { id: number; title: string } } = $props();
    let canvas: HTMLCanvasElement;
    let state = $state<"loading" | "ready" | "error">("loading");
    let generation = 0;
    let loadingTask: any = null;
    let documentProxy: any = null;

    async function renderPreview(run: number) {
        state = "loading";
        try {
            const pdfjs = await import("pdfjs-dist");
            if (run !== generation || !canvas) return;
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
            loadingTask = pdfjs.getDocument({
                url: `/api/file/${item.id}`,
                disableAutoFetch: true,
                disableStream: true,
                rangeChunkSize: 65536,
            });
            documentProxy = await loadingTask.promise;
            const page = await documentProxy.getPage(1);
            if (run !== generation) return;

            const bounds = canvas.parentElement?.getBoundingClientRect();
            const baseViewport = page.getViewport({ scale: 1 });
            const targetWidth = Math.max(240, Math.min(bounds?.width || 520, 560));
            const scale = targetWidth / baseViewport.width;
            const viewport = page.getViewport({ scale });
            const ratio = window.devicePixelRatio || 1;
            canvas.width = Math.ceil(viewport.width * ratio);
            canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = `${Math.ceil(viewport.width)}px`;
            canvas.style.height = `${Math.ceil(viewport.height)}px`;
            await page.render({
                canvasContext: canvas.getContext("2d", { alpha: false })!,
                viewport,
                transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
            }).promise;
            if (run === generation) state = "ready";
        } catch {
            if (run === generation) state = "error";
        }
    }

    function cleanup() {
        generation += 1;
        try { loadingTask?.destroy(); } catch {}
        try { documentProxy?.destroy(); } catch {}
        loadingTask = null;
        documentProxy = null;
    }

    $effect(() => {
        item.id;
        const run = ++generation;
        renderPreview(run);
        return cleanup;
    });

    onDestroy(cleanup);
</script>

<div class="relative flex items-center justify-center w-full h-full min-h-48 overflow-hidden">
    {#if state === "loading"}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
            <div class="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
            <span class="text-[10px] uppercase tracking-wider">Loading first page</span>
        </div>
    {:else if state === "error"}
        <div class="text-center text-text-muted px-6">
            <div class="text-sm text-text-secondary">Preview unavailable</div>
            <div class="text-[10px] mt-1">Press Read to open the full document.</div>
        </div>
    {/if}
    <canvas bind:this={canvas} class:opacity-0={state !== "ready"} class="max-w-full max-h-full object-contain shadow-xl transition-opacity duration-200" aria-label={`First page preview of ${item.title}`}></canvas>
</div>
