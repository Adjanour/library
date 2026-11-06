import { dirname, extname, join, normalize } from "node:path/posix";
import { join as joinFs } from "@std/path";
import type { DB } from "../db.ts";
import { appCacheRoot } from "../platform.ts";

export type Thumbnail = { path: string; contentType: string; etag: string };

function attribute(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
  return match?.[1] ?? "";
}

function xmlText(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll(
    "&apos;",
    "'",
  );
}

export function selectCoverEntry(
  opfPath: string,
  opf: string,
): { entry: string; contentType: string } | null {
  const tags = [...opf.matchAll(/<item\b[^>]*>/gi)].map((match) => match[0]);
  const legacyCoverId =
    /<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i
      .exec(opf)?.[1] ?? "";
  const selected =
    tags.find((tag) =>
      attribute(tag, "properties").split(/\s+/).includes("cover-image")
    ) ??
      tags.find((tag) =>
        legacyCoverId !== "" && attribute(tag, "id") === legacyCoverId
      ) ??
      tags.find((tag) =>
        /(^|[/_.-])cover([/_.-]|$)/i.test(attribute(tag, "href"))
      );
  if (!selected) return null;
  const href = xmlText(attribute(selected, "href"));
  if (!href) return null;
  const entry = normalize(join(dirname(opfPath), href)).replace(/^\.\//, "");
  if (entry.startsWith("../") || entry.startsWith("/")) return null;
  return {
    entry,
    contentType: attribute(selected, "media-type") || contentTypeFor(entry),
  };
}

function contentTypeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".png"
    ? "image/png"
    : extension === ".webp"
    ? "image/webp"
    : extension === ".gif"
    ? "image/gif"
    : "image/jpeg";
}

async function unzipEntry(
  archive: string,
  entry: string,
): Promise<Uint8Array | null> {
  try {
    const output = await new Deno.Command("unzip", {
      args: ["-p", archive, entry],
      stdout: "piped",
      stderr: "null",
    }).output();
    return output.success && output.stdout.length > 0 ? output.stdout : null;
  } catch {
    return null;
  }
}

export class ThumbnailService {
  private readonly root = joinFs(appCacheRoot(), "library", "thumbnails");
  private readonly inFlight = new Map<number, Promise<Thumbnail | null>>();

  constructor(private readonly db: DB) {}

  get(itemId: number): Promise<Thumbnail | null> {
    const existing = this.inFlight.get(itemId);
    if (existing) return existing;
    const work = this.generate(itemId).finally(() =>
      this.inFlight.delete(itemId)
    );
    this.inFlight.set(itemId, work);
    return work;
  }

  private async generate(itemId: number): Promise<Thumbnail | null> {
    const item = this.db.getItem(itemId);
    if (!item.ok) return null;
    let source: Deno.FileInfo;
    try {
      source = await Deno.stat(item.value.path);
    } catch {
      return null;
    }
    const fingerprint = `${itemId}-${source.size}-${
      source.mtime?.getTime() ?? 0
    }`;
    await Deno.mkdir(this.root, { recursive: true });

    if (item.value.filename.toLowerCase().endsWith(".pdf")) {
      const output = joinFs(this.root, `${fingerprint}.jpg`);
      try {
        await Deno.stat(output);
        return { path: output, contentType: "image/jpeg", etag: fingerprint };
      } catch { /* generate */ }
      try {
        const base = output.slice(0, -4);
        const result = await new Deno.Command("pdftoppm", {
          args: [
            "-f",
            "1",
            "-singlefile",
            "-scale-to",
            "480",
            "-jpeg",
            item.value.path,
            base,
          ],
          stdout: "null",
          stderr: "null",
        }).output();
        return result.success
          ? { path: output, contentType: "image/jpeg", etag: fingerprint }
          : null;
      } catch {
        return null;
      }
    }

    if (!item.value.filename.toLowerCase().endsWith(".epub")) return null;
    const container = await unzipEntry(
      item.value.path,
      "META-INF/container.xml",
    );
    if (!container) return null;
    const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(
      new TextDecoder().decode(container),
    )?.[1];
    if (!opfPath) return null;
    const opfBytes = await unzipEntry(item.value.path, opfPath);
    if (!opfBytes) return null;
    const cover = selectCoverEntry(opfPath, new TextDecoder().decode(opfBytes));
    if (!cover) return null;
    const bytes = await unzipEntry(item.value.path, cover.entry);
    if (!bytes) return null;
    const extension = extname(cover.entry).toLowerCase();
    const safeExtension =
      [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)
        ? extension
        : ".jpg";
    const output = joinFs(this.root, `${fingerprint}${safeExtension}`);
    try {
      await Deno.stat(output);
    } catch {
      const temporary = `${output}.tmp-${crypto.randomUUID()}`;
      await Deno.writeFile(temporary, bytes);
      await Deno.rename(temporary, output);
    }
    return {
      path: output,
      contentType: cover.contentType || contentTypeFor(output),
      etag: fingerprint,
    };
  }
}
