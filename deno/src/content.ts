import { basename, extname } from "@std/path";
import type {
  ContentIndexStatus,
  DocumentChunk,
  Item,
} from "./types.ts";

const MAX_CHARS = 500_000;
const CHUNK_CHARS = 3_200;
const OCR_PAGES = 20;

async function command(name: string, args: string[]): Promise<string> {
  const result = await new Deno.Command(name, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

function plainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ").replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replace(/\s+/g, " ").trim();
}

function chunks(text: string, prefix: string): DocumentChunk[] {
  const output: DocumentChunk[] = [];
  for (let offset = 0, index = 1; offset < text.length; index++) {
    let end = Math.min(text.length, offset + CHUNK_CHARS);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > offset + CHUNK_CHARS / 2) end = boundary;
    }
    const content = text.slice(offset, end).trim();
    if (content) output.push({ location: `${prefix} ${index}`, heading: "", content });
    offset = end + 1;
  }
  return output;
}

async function pdfText(path: string): Promise<DocumentChunk[]> {
  const text = await command("pdftotext", ["-layout", path, "-"]);
  const pages = text.split("\f");
  const output: DocumentChunk[] = [];
  for (let page = 0; page < pages.length; page++) {
    const content = pages[page]!.replace(/\s+/g, " ").trim();
    if (content.length < 20) continue;
    output.push(...chunks(content, `Page ${page + 1}`));
    if (output.reduce((total, chunk) => total + chunk.content.length, 0) >= MAX_CHARS) break;
  }
  return output;
}

async function epubText(path: string): Promise<DocumentChunk[]> {
  const entries = (await command("unzip", ["-Z1", path])).split("\n")
    .filter((entry) => /\.(xhtml?|html)$/i.test(entry)).slice(0, 2_000);
  const output: DocumentChunk[] = [];
  for (const entry of entries) {
    const raw = await command("unzip", ["-p", path, entry]);
    const heading = plainText(raw.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    for (const chunk of chunks(plainText(raw), basename(entry))) {
      output.push({ ...chunk, heading });
    }
    if (output.reduce((total, chunk) => total + chunk.content.length, 0) >= MAX_CHARS) break;
  }
  return output;
}

async function ocrPdf(path: string): Promise<DocumentChunk[]> {
  const directory = await Deno.makeTempDir({ prefix: "library-ocr-" });
  try {
    const prefix = `${directory}/page`;
    await command("pdftoppm", ["-f", "1", "-l", String(OCR_PAGES), "-r", "150", "-png", path, prefix]);
    const images = [...Deno.readDirSync(directory)].filter((entry) => entry.isFile)
      .map((entry) => `${directory}/${entry.name}`).sort();
    const output: DocumentChunk[] = [];
    for (let index = 0; index < images.length; index++) {
      const content = (await command("tesseract", [images[index]!, "stdout", "-l", "eng"])).replace(/\s+/g, " ").trim();
      if (content) output.push(...chunks(content, `Page ${index + 1}`));
    }
    return output;
  } finally {
    await Deno.remove(directory, { recursive: true }).catch(() => undefined);
  }
}

export async function extractDocumentContent(
  item: Item,
  useOcr = false,
): Promise<{ status: ContentIndexStatus; chunks: DocumentChunk[]; error?: string }> {
  const extension = extname(item.path).toLowerCase();
  try {
    if (extension === ".pdf") {
      const extracted = useOcr ? await ocrPdf(item.path) : await pdfText(item.path);
      const characters = extracted.reduce((total, chunk) => total + chunk.content.length, 0);
      if (!extracted.length) return { status: useOcr ? "failed" : "needs_ocr", chunks: [] };
      return { status: characters >= MAX_CHARS ? "truncated" : "indexed", chunks: extracted };
    }
    if (extension === ".epub") {
      const extracted = await epubText(item.path);
      const characters = extracted.reduce((total, chunk) => total + chunk.content.length, 0);
      return { status: characters >= MAX_CHARS ? "truncated" : "indexed", chunks: extracted };
    }
    return { status: "unavailable", chunks: [], error: "Only PDF and EPUB are indexable." };
  } catch (error) {
    return { status: "failed", chunks: [], error: error instanceof Error ? error.message.slice(0, 500) : "Extraction failed" };
  }
}
