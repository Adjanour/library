export const EPUB_RENDITION_METHODS = ["write", "srcdoc", "blobUrl"] as const;

export type EpubRenditionMethod = (typeof EPUB_RENDITION_METHODS)[number];

export async function openWithRenditionFallback<T>(options: {
  create: (method: EpubRenditionMethod) => T;
  display: (rendition: T, method: EpubRenditionMethod) => Promise<void>;
  dispose: (rendition: T) => void;
  timeoutMs: number;
  methods?: readonly EpubRenditionMethod[];
}): Promise<{ rendition: T; method: EpubRenditionMethod }> {
  const failures: string[] = [];
  for (const method of options.methods ?? EPUB_RENDITION_METHODS) {
    const rendition = options.create(method);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.display(rendition, method),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), options.timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return { rendition, method };
    } catch (error) {
      if (timer) clearTimeout(timer);
      failures.push(`${method}: ${error instanceof Error ? error.message : String(error)}`);
      options.dispose(rendition);
    }
  }
  throw new Error(`Unable to render this EPUB (${failures.join("; ")})`);
}
