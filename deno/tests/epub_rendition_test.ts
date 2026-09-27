import { assertEquals } from "@std/assert";
import {
  EPUB_RENDITION_METHODS,
  openWithRenditionFallback,
} from "../../web/svelte/src/lib/epubRendition.ts";

Deno.test("EPUB rendition prefers document.write for desktop webviews", () => {
  assertEquals(EPUB_RENDITION_METHODS, ["write", "srcdoc", "blobUrl"]);
});

Deno.test("EPUB rendition disposes a timed-out method and falls back", async () => {
  const disposed: string[] = [];
  const result = await openWithRenditionFallback({
    create: (method) => method,
    display: async (_rendition, method) => {
      if (method === "write") await new Promise(() => {});
    },
    dispose: (rendition) => disposed.push(rendition),
    timeoutMs: 5,
  });

  assertEquals(result.method, "srcdoc");
  assertEquals(disposed, ["write"]);
});
