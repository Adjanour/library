import { basename, dirname } from "@std/path";
import { DB } from "../src/db.ts";

type ZipEntry = { name: string; data: Uint8Array; offset: number; crc: number };

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zip(entries: Array<{ name: string; text: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const indexed: ZipEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);
    const header = concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    );
    local.push(header);
    indexed.push({ name: entry.name, data, offset, crc });
    offset += header.length;
  }

  const centralOffset = offset;
  for (const entry of indexed) {
    const name = encoder.encode(entry.name);
    const header = concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(entry.crc), u32(entry.data.length), u32(entry.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset),
      name,
    );
    central.push(header);
    offset += header.length;
  }

  const centralSize = offset - centralOffset;
  const end = concat(
    u32(0x06054b50), u16(0), u16(0), u16(indexed.length), u16(indexed.length),
    u32(centralSize), u32(centralOffset), u16(0),
  );
  return concat(...local, ...central, end);
}

const [dbPath, epubPath] = Deno.args;
if (!dbPath || !epubPath) {
  console.error("usage: deno run --allow-all deno/scripts/seed-epub-smoke.ts <db-path> <epub-path>");
  Deno.exit(2);
}

const fixture = zip([
  { name: "mimetype", text: "application/epub+zip" },
  {
    name: "META-INF/container.xml",
    text: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  },
  {
    name: "OEBPS/content.opf",
    text: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Desktop EPUB Smoke Fixture</dc:title><dc:creator>Library Test</dc:creator><dc:language>en</dc:language><dc:identifier id="book-id">library-smoke</dc:identifier></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
  },
  {
    name: "OEBPS/chapter.xhtml",
    text: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Smoke</title></head><body><h1>Library EPUB smoke test</h1><p>This fixture verifies the packaged reader can render an EPUB chapter.</p></body></html>`,
  },
]);

await Deno.mkdir(dirname(epubPath), { recursive: true });
await Deno.writeFile(epubPath, fixture);
const stat = await Deno.stat(epubPath);
const db = new DB(dbPath);
const result = db.upsertItem({
  id: 0,
  title: "Desktop EPUB Smoke Fixture",
  authors: "Library Test",
  year: 2026,
  path: epubPath,
  filename: basename(epubPath),
  type: "ebook",
  category: "test",
  tags: "smoke",
  purpose: "desktop validation",
  description: "Generated fixture for packaged EPUB reader smoke tests.",
  size: stat.size,
  added_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
if (!result.ok) throw new Error(result.error.message);
const item = db.getItemByPath(epubPath);
if (!item.ok) throw new Error(item.error.message);
console.log(JSON.stringify({ item_id: item.value.id, epub_path: epubPath, bytes: stat.size }));
db.close();
