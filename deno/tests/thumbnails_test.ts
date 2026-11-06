import { assertEquals } from "@std/assert";
import { selectCoverEntry } from "../src/application/thumbnails.ts";

Deno.test("thumbnail cover selection prefers EPUB cover-image metadata", () => {
  const opf = `<manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="cover" href="images/front.jpg" media-type="image/jpeg" properties="cover-image" />
  </manifest>`;
  assertEquals(selectCoverEntry("OEBPS/content.opf", opf), {
    entry: "OEBPS/images/front.jpg",
    contentType: "image/jpeg",
  });
});

Deno.test("thumbnail cover selection supports EPUB 2 cover metadata", () => {
  const opf =
    `<metadata><meta name="cover" content="art" /></metadata><manifest>
    <item id="art" href="cover.png" media-type="image/png" />
  </manifest>`;
  assertEquals(selectCoverEntry("OPS/package.opf", opf), {
    entry: "OPS/cover.png",
    contentType: "image/png",
  });
});
