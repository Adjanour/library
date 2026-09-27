export const EPUB_RENDITION_METHODS = ["write", "srcdoc", "blobUrl"] as const;

export type EpubRenditionMethod = (typeof EPUB_RENDITION_METHODS)[number];

export type EpubRenditionAttempt = {
  method: EpubRenditionMethod;
  phase: "start" | "created" | "display" | "success" | "failure" | "timeout" | "disposed";
  elapsedMs: number;
  error?: string;
};

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function openWithRenditionFallback<T>(options: {
  create: (method: EpubRenditionMethod) => T;
  display: (rendition: T, method: EpubRenditionMethod) => Promise<void>;
  dispose: (rendition: T) => void;
  timeoutMs: number;
  methods?: readonly EpubRenditionMethod[];
  onAttempt?: (event: EpubRenditionAttempt) => void;
}): Promise<{ rendition: T; method: EpubRenditionMethod }> {
  const failures: string[] = [];
  for (const method of options.methods ?? EPUB_RENDITION_METHODS) {
    const startedAt = now();
    const emit = (phase: EpubRenditionAttempt["phase"], error?: unknown) => {
      try {
        options.onAttempt?.({
          method,
          phase,
          elapsedMs: Math.round(now() - startedAt),
          ...(error === undefined
            ? {}
            : { error: error instanceof Error ? error.message : String(error) }),
        });
      } catch {
        // Diagnostics must never change reader behavior.
      }
    };
    emit("start");
    let rendition: T | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      rendition = options.create(method);
      emit("created");
      emit("display");
      const display = options.display(rendition, method);
      display.then(
        () => undefined,
        () => undefined,
      );
      await Promise.race([
        display,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), options.timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      emit("success");
      return { rendition, method };
    } catch (error) {
      if (timer) clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      emit(message === "timed out" ? "timeout" : "failure", error);
      failures.push(`${method}: ${message}`);
      if (rendition !== undefined) {
        options.dispose(rendition);
        emit("disposed");
      }
    }
  }
  throw new Error(`Unable to render this EPUB (${failures.join("; ")})`);
}
