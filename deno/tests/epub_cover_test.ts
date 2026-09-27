import { assertEquals } from "@std/assert";
import { selectEpubCoverCandidate } from "../../web/svelte/src/lib/epubCover.ts";

Deno.test("cover selection prefers explicit cover-image metadata", () => {
  const result = selectEpubCoverCandidate([
    { id: "chapter-image", href: "images/chapter.png", "media-type": "image/png", properties: [] },
    { id: "cover", href: "images/front.png", "media-type": "image/png", properties: ["cover-image"] },
  ]);
  assertEquals(result?.id, "cover");
});

Deno.test("cover selection prefers cover-named assets before illustrations", () => {
  const result = selectEpubCoverCandidate([
    { id: "asset-1", href: "images/page-1.jpg", "media-type": "image/jpeg", properties: [] },
    { id: "cover-image", href: "images/cover.png", "media-type": "image/png", properties: [] },
  ]);
  assertEquals(result?.href, "images/cover.png");
});

Deno.test("cover selection skips obvious non-cover artwork", () => {
  const result = selectEpubCoverCandidate([
    { id: "logo", href: "images/logo.png", "media-type": "image/png", properties: [] },
    { id: "asset-1", href: "images/page-1.jpg", "media-type": "image/jpeg", properties: [] },
  ]);
  assertEquals(result?.href, "images/page-1.jpg");
});
