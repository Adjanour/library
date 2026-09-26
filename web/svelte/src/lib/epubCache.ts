type EpubBook = any;

type WarmEntry = {
    book: EpubBook;
    opening: Promise<unknown>;
    controller: AbortController;
};

type PendingEntry = {
    controller: AbortController;
    book: EpubBook | null;
    promise: Promise<WarmEntry>;
};

import { BoundedLru } from "$lib/boundedLru";
import { selectEpubCoverCandidate } from "$lib/epubCover";
export { selectEpubCoverCandidate } from "$lib/epubCover";

const pending = new Map<number, PendingEntry>();
const MAX_CACHED_EPUBS = 2;
let modulePromise: Promise<any> | null = null;

const entries = new BoundedLru<number, WarmEntry>(MAX_CACHED_EPUBS, (_itemId, entry) => {
    disposeEntry(entry);
});

function loadModule() {
    // @ts-expect-error The package's browser bundle lacks a declaration file.
    modulePromise ??= import("@intity/epub-js/dist/public/epub.js").then((module) => module.default);
    return modulePromise;
}

export async function warmEpub(itemId: number): Promise<WarmEntry> {
    const existing = entries.get(itemId);
    if (existing) {
        return existing;
    }

    const inFlight = pending.get(itemId);
    if (inFlight) return inFlight.promise;

    const controller = new AbortController();
    const pendingEntry = { controller, book: null as EpubBook | null, promise: null as unknown as Promise<WarmEntry> };
    const promise = (async () => {
        const ePub = await loadModule();
        const response = await fetch(`/api/file/${itemId}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (controller.signal.aborted) throw new DOMException("EPUB warm-up cancelled", "AbortError");
        const book = ePub({ replacements: "base64" });
        pendingEntry.book = book;
        const opening = Promise.resolve(book.open(buffer, "binary"));
        const entry = { book, opening, controller };
        entries.set(itemId, entry);
        opening.catch(() => {
            if (entries.get(itemId) === entry) entries.delete(itemId);
        });
        return entry;
    })();
    pendingEntry.promise = promise;
    pending.set(itemId, pendingEntry);
    promise.then(
        () => { if (pending.get(itemId)?.promise === promise) pending.delete(itemId); },
        () => { if (pending.get(itemId)?.promise === promise) pending.delete(itemId); },
    );
    return promise;
}

export function releaseEpub(itemId: number) {
    entries.delete(itemId);

    const inFlight = pending.get(itemId);
    if (inFlight) {
        pending.delete(itemId);
        inFlight.controller.abort();
        try { inFlight.book?.destroy(); } catch {}
    }
}

function disposeEntry(entry: WarmEntry) {
    entry.controller.abort();
    try { entry.book.destroy(); } catch {}
}

/** Return a cover URL through epub-js, with a manifest-image fallback. */
export async function getEpubCoverUrl(itemId: number): Promise<string> {
    const { book, opening } = await warmEpub(itemId);
    await opening;
    const declared = await book.coverUrl();
    if (declared) return declared;

    const manifest = book.packaging?.manifest;
    const candidate = selectEpubCoverCandidate(manifest ? [...manifest.values()] : []);
    if (!candidate?.href || !book.resources?.createUrl) return "";
    return await book.resources.createUrl(candidate.href, candidate["media-type"]);
}
