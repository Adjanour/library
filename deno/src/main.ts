import { Hono } from "hono";
import { DB } from "./db.ts";
import { Err, match } from "./result.ts";
import type { Result } from "./result.ts";
import { AppError } from "./result.ts";
import {
  BookmarkSchema,
  AnnotationSchema,
  BulkItemUpdateSchema,
  CollectionCreateSchema,
  CollectionItemUpdateSchema,
  CollectionReorderSchema,
  CollectionUpdateSchema,
  IdParamSchema,
  ItemUpdateSchema,
  ReaderPreferencesSchema,
  ReadingProgressUpdateSchema,
  SearchQuerySchema,
  SettingsSchema,
} from "./validate.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { appCacheRoot, defaultScanDirectories } from "./platform.ts";
import { Application } from "./application/lifecycle.ts";
import { createRuntimeRoutes } from "./http/routes.ts";
import { ReadingService } from "./application/reading.ts";
import { QueueService } from "./application/queue.ts";
import { LibraryService } from "./application/library.ts";
import { SettingsService } from "./application/settings.ts";
import { ScanningService } from "./application/scanning.ts";
import { FilesService } from "./application/files.ts";
import { ThumbnailService } from "./application/thumbnails.ts";
import { extractDocumentContent } from "./content.ts";
import { EnrichmentService } from "./application/enrichment.ts";
import { GrobidService } from "./application/grobid.ts";

const moduleStartedAt = performance.now();
const app = new Hono();
const databaseStartedAt = performance.now();
const db = new DB(Deno.env.get("LIBRARY_DB_PATH") || undefined);
const APP_VERSION = "0.2.0";
const application = new Application(db);
application.recordStage("database", performance.now() - databaseStartedAt);
application.transition("DatabaseReady");
const servicesStartedAt = performance.now();
const reading = new ReadingService(db);
const queue = new QueueService(db);
const library = new LibraryService(db);
const settings = new SettingsService(db, defaultScanDirectories());
const scanning = new ScanningService(db);
const files = new FilesService(db);
const thumbnails = new ThumbnailService(db);
const enrichment = new EnrichmentService();
const grobid = new GrobidService();
const epubDiagnostics: Array<Record<string, unknown>> = [];
application.recordStage("services", performance.now() - servicesStartedAt);

app.route("/", createRuntimeRoutes(db, application, APP_VERSION));

function respond<T>(result: Result<T>): Response {
  return match(result, {
    ok: (data) =>
      data === undefined ? Response.json({ ok: true }) : Response.json(data),
    err: (e) =>
      Response.json(
        { error: e.message },
        { status: e.code === "NOT_FOUND" ? 404 : 500 },
      ),
  });
}

function parseId(param: string): Result<number> {
  const result = IdParamSchema.safeParse({ id: param });
  if (!result.success) {
    return { ok: false, error: AppError("VALIDATION", result.error.message) };
  }
  return { ok: true, value: result.data.id };
}

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    fts: db.fts,
    version: APP_VERSION,
    lifecycle_state: application.state,
  });
});

app.get("/api/search", (c) => {
  const result = SearchQuerySchema.safeParse({
    q: c.req.query("q"),
    type: c.req.query("type"),
    category: c.req.query("category"),
    tag: c.req.query("tag"),
    purpose: c.req.query("purpose"),
    year: c.req.query("year"),
    sort: c.req.query("sort"),
    order: c.req.query("order"),
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
    status: c.req.query("status"),
    types: c.req.queries("type"),
    categories: c.req.queries("category"),
    tags: c.req.queries("tag"),
    purposes: c.req.queries("purpose"),
  });
  if (!result.success) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return respond(library.search(result.data));
});

app.get("/api/search/content", (c) => {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length < 2 || query.length > 500) {
    return Response.json({ error: "q must be between 2 and 500 characters" }, { status: 400 });
  }
  const limit = Number(c.req.query("limit") ?? "8");
  return respond(library.contentSearch(query, Number.isFinite(limit) ? limit : 8));
});

app.get("/api/content-index/stats", () => Response.json(db.getContentIndexStats()));

app.get("/api/stats", () => respond(library.stats()));
app.get("/api/categories", () => respond(library.categories()));
app.get("/api/tags", () => respond(library.tags()));
app.get("/api/purposes", () => respond(library.purposes()));

app.get("/api/items/:id/suggestions", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const item = library.item(id.value);
  if (!item.ok) return respond(item);
  return Response.json(library.suggestions(id.value));
});

app.get("/api/metadata-suggestions/pending", () =>
  Response.json(library.pendingSuggestions()));

app.post("/api/items/:id/enrich", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const item = library.item(id.value);
  if (!item.ok) return respond(item);
  const body = await c.req.json().catch(() => ({}));
  const allowTitleLookup = Boolean(body && typeof body === "object" && "allow_title_lookup" in body && body.allow_title_lookup);
  const suggestions = await enrichment.enrich(item.value, allowTitleLookup);
  const saved = library.saveSuggestions(id.value, suggestions);
  if (!saved.ok) return respond(saved);
  return Response.json({ saved: saved.value, suggestions: library.suggestions(id.value) });
});

app.post("/api/items/:id/extract-grobid", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const item = library.item(id.value);
  if (!item.ok) return respond(item);
  if (!grobid.configured) {
    return Response.json({ error: "GROBID_URL is not configured" }, { status: 503 });
  }
  try {
    const candidates = await grobid.extract(item.value);
    const saved = library.saveSuggestions(id.value, candidates);
    if (!saved.ok) return respond(saved);
    return Response.json({ saved: saved.value, suggestions: library.suggestions(id.value) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "GROBID extraction failed" },
      { status: 502 },
    );
  }
});

app.post("/api/metadata-suggestions/:id/:action", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const action = c.req.param("action");
  if (action !== "apply" && action !== "reject") {
    return Response.json({ error: "action must be apply or reject" }, { status: 400 });
  }
  return respond(library.resolveSuggestion(id.value, action === "apply"));
});

app.get("/api/settings", () =>
  Response.json({
    scan_directories: settings.scanDirectories(),
    catalog_page_size: settings.catalogPageSize(),
    platform: Deno.build.os,
    version: APP_VERSION,
    smoke_item_id: Number(Deno.env.get("LIBRARY_EPUB_SMOKE_ID")) || undefined,
    reading_preferences: settings.readerPreferences(),
    grobid_configured: grobid.configured,
  }));

app.put("/api/settings/reading", async (c) => {
  const parsed = ReaderPreferencesSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  settings.saveReaderPreferences(parsed.data);
  return Response.json(parsed.data);
});

app.get("/api/diagnostics/epub", () => Response.json(epubDiagnostics));
app.get("/api/diagnostics/startup", () =>
  Response.json({
    module_elapsed_ms: Math.round((performance.now() - moduleStartedAt) * 100) /
      100,
    stages: application.stageLog,
  }));

app.post("/api/diagnostics/epub", async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  epubDiagnostics.push({
    timestamp: new Date().toISOString(),
    ...(payload && typeof payload === "object" ? payload : { payload }),
  });
  if (epubDiagnostics.length > 200) epubDiagnostics.splice(0, 100);
  return c.json({ ok: true }, 201);
});

app.put("/api/settings", async (c) => {
  const parsed = SettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const saved = await settings.saveScanDirectories(
    parsed.data.scan_directories,
  );
  if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
  if (parsed.data.catalog_page_size) {
    settings.saveCatalogPageSize(parsed.data.catalog_page_size);
  }
  return Response.json({
    scan_directories: saved.directories,
    catalog_page_size: settings.catalogPageSize(),
    platform: Deno.build.os,
    version: APP_VERSION,
  });
});

// Collections

app.get("/api/collections", () => respond(library.collections()));

app.post("/api/collections", async (c) => {
  const parsed = CollectionCreateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const created = library.createCollection(
    parsed.data.name,
    parsed.data.description,
  );
  return match(created, {
    ok: (collection) => Response.json(collection, { status: 201 }),
    err: (e) => respond(Err(e)),
  });
});

app.put("/api/collections/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = CollectionUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  return respond(library.updateCollection(id.value, parsed.data.name, parsed.data.description));
});

app.delete("/api/collections/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const deleted = library.deleteCollection(id.value);
  return match(deleted, {
    ok: () => Response.json({ status: "deleted" }),
    err: (e) => respond(Err(e)),
  });
});

app.get("/api/collections/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  return respond(library.collection(id.value));
});

app.get("/api/collections/:id/items", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  return respond(library.collectionItems(id.value));
});

app.post("/api/collections/:id/items", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = CollectionItemUpdateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const added = library.addToCollection(id.value, parsed.data.item_id);
  return match(added, {
    ok: () => Response.json({ status: "added" }),
    err: (e) => respond(Err(e)),
  });
});

app.delete("/api/collections/:id/items/:item_id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const itemId = parseId(c.req.param("item_id"));
  if (!itemId.ok) return respond(itemId);
  const removed = library.removeFromCollection(id.value, itemId.value);
  return match(removed, {
    ok: () => Response.json({ status: "removed" }),
    err: (e) => respond(Err(e)),
  });
});
app.post("/api/collections/:id/reorder", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = CollectionReorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  return respond(library.reorderCollectionItems(id.value, parsed.data.ids));
});

app.get("/api/items/:id/evidence", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? Response.json(library.evidence(id.value)) : respond(id);
});

app.get("/api/items/:id/related", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(library.relatedCopies(id.value)) : respond(id);
});

app.get("/api/items/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(library.item(id.value)) : respond(id);
});

app.put("/api/items/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);

  const body = await c.req.json();
  const parsed = ItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const result = library.update(id.value, parsed.data);
  if (!result.ok) return respond(result);
  return respond(library.item(id.value));
});

app.delete("/api/items/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(library.delete(id.value)) : respond(id);
});

app.post("/api/items/:id/restore", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(library.restore(id.value)) : respond(id);
});

app.delete("/api/items/:id/permanent", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(library.permanentlyDelete(id.value)) : respond(id);
});

app.patch("/api/items/bulk", async (c) => {
  const parsed = BulkItemUpdateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const result = library.bulkUpdate(parsed.data.ids, parsed.data.updates);
  return respond(result);
});

app.post("/api/edits/:batch_id/undo", (c) => {
  return respond(library.undo(c.req.param("batch_id")));
});

app.on(["GET", "POST"], "/api/open/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(files.open(id.value)) : respond(id);
});

async function fileMetaHeaders(path: string, filename: string, total: number) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    epub: "application/epub+zip",
    mobi: "application/x-mobipocket-ebook",
    djvu: "image/vnd.djvu",
  };
  let mtime = 0;
  try {
    const stat = await Deno.stat(path);
    mtime = stat.mtime?.getTime() ?? 0;
  } catch { /* ignore */ }
  return {
    "content-type": mimeTypes[ext] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "etag": `"${total}-${mtime}"`,
    "last-modified": mtime
      ? new Date(mtime).toUTCString()
      : new Date(0).toUTCString(),
  };
}

// HEAD serves metadata only so the PDF reader can learn the file length
// (and range support) without downloading anything.
async function fileHead(c: any) {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return Response.json({ error: "invalid id" }, { status: 400 });
  const item = files.item(id.value);
  if (!item.ok) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const stat = await Deno.stat(item.value.path);
    const headers = await fileMetaHeaders(
      item.value.path,
      item.value.filename,
      stat.size,
    );
    return new Response(null, {
      headers: { ...headers, "content-length": String(stat.size) },
    });
  } catch {
    return Response.json({ error: "file not found" }, { status: 404 });
  }
}
app.on("HEAD", "/api/file/:id", fileHead);

app.get("/api/thumbnail/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return Response.json({ error: "invalid id" }, { status: 400 });
  const thumbnail = await thumbnails.get(id.value);
  if (!thumbnail) {
    return Response.json({ error: "thumbnail unavailable" }, { status: 404 });
  }
  const etag = `"${thumbnail.etag}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  const file = await Deno.open(thumbnail.path, { read: true });
  return new Response(file.readable, {
    headers: {
      "content-type": thumbnail.contentType,
      "cache-control": "private, max-age=3600",
      etag,
    },
  });
});

app.get("/api/file/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return Response.json({ error: "invalid id" }, { status: 400 });
  const item = files.item(id.value);
  if (!item.ok) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const stat = await Deno.stat(item.value.path);
    const total = stat.size;
    const meta = await fileMetaHeaders(
      item.value.path,
      item.value.filename,
      total,
    );
    const contentType = meta["content-type"];
    const range = c.req.header("range");
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const rawStart = match[1] ?? "";
        const rawEnd = match[2] ?? "";
        let start = rawStart === "" ? null : parseInt(rawStart, 10);
        let end = rawEnd === "" ? null : parseInt(rawEnd, 10);
        if (start === null && end !== null) {
          start = Math.max(0, total - end);
          end = total - 1;
        } else {
          start = start ?? 0;
          end = end === null || end >= total ? total - 1 : end;
        }
        if (start >= 0 && end >= start && start < total) {
          const len = end - start + 1;
          const f = await Deno.open(item.value.path, { read: true });
          try {
            await f.seek(start, Deno.SeekMode.Start);
            const buf = new Uint8Array(len);
            let read = 0;
            while (read < len) {
              const n = await f.read(buf.subarray(read));
              if (n === null) break;
              read += n;
            }
            return new Response(buf.subarray(0, read), {
              status: 206,
              headers: {
                ...meta,
                "content-type": contentType,
                "content-length": String(read),
                "content-range": `bytes ${start}-${start + read - 1}/${total}`,
              },
            });
          } finally {
            f.close();
          }
        }
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "content-range": `bytes */${total}` },
        });
      }
    }
    // Stream the file instead of buffering it: pdf.js opens every document
    // with a full GET before switching to ranges, then aborts it. Buffering
    // a 130MB file for an aborted response stalls the event loop and wastes
    // memory; streaming makes the abort nearly free.
    const f = await Deno.open(item.value.path, { read: true });
    return new Response(f.readable, {
      headers: {
        ...meta,
        "content-type": contentType,
        "content-length": String(total),
      },
    });
  } catch {
    return Response.json({ error: "file not found" }, { status: 404 });
  }
});

// Reading routes

app.get("/api/reading/progress", () => {
  return Response.json(db.getAllReadingProgress());
});

app.get("/api/reading/progress/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const progress = db.getReadingProgress(id.value);
  if (!progress) {
    return Response.json({
      item_id: id.value,
      status: "unread",
      progress_percent: 0,
      current_page: 0,
      total_pages: 0,
      started_at: null,
      finished_at: null,
      last_read_at: null,
      updated_at: new Date().toISOString(),
    });
  }
  return Response.json(progress);
});

app.post("/api/reading/progress/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = ReadingProgressUpdateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  return Response.json(reading.progress(id.value, parsed.data));
});

app.post("/api/reading/start/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const session = reading.start(id.value);
  return Response.json(session);
});

app.post("/api/reading/heartbeat/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  return Response.json(reading.heartbeat(id.value));
});

app.get("/api/reading/bookmarks/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  return Response.json(db.getBookmarks(id.value));
});

app.post("/api/reading/bookmarks/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = BookmarkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  return Response.json(
    db.addBookmark(
      id.value,
      parsed.data.location,
      parsed.data.label,
      parsed.data.percent,
    ),
  );
});

app.delete("/api/reading/bookmarks/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const location = c.req.query("location");
  if (!location) {
    return Response.json({ error: "location is required" }, { status: 400 });
  }
  return Response.json({ removed: db.removeBookmark(id.value, location) });
});

app.get("/api/reading/annotations/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? Response.json(db.getAnnotations(id.value)) : respond(id);
});
app.post("/api/reading/annotations/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const parsed = AnnotationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  return Response.json(db.addAnnotation(id.value, parsed.data.cfi_range, parsed.data.text, parsed.data.note));
});
app.delete("/api/reading/annotations/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const range = c.req.query("cfi_range");
  if (!range) return Response.json({ error: "cfi_range is required" }, { status: 400 });
  return Response.json({ removed: db.removeAnnotation(id.value, range) });
});

app.post("/api/reading/stop/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const session = db.getActiveSession(id.value);
  if (!session) {
    return Response.json({ error: "no active session" }, { status: 404 });
  }
  const body = await c.req.json().catch(() => ({ pages_read: 0 }));
  db.stopReadingSession(session.id, body.pages_read ?? 0);
  return Response.json({ status: "stopped" });
});

app.get("/api/reading/sessions/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  return Response.json(db.getReadingSessions(id.value, 20));
});

app.get("/api/reading/queue", () => {
  return Response.json(queue.list());
});

app.post("/api/reading/queue", async (c) => {
  const body = await c.req.json();
  queue.add(body);
  return Response.json(body);
});

app.delete("/api/reading/queue/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  queue.remove(id.value);
  return Response.json({ status: "removed" });
});

app.post("/api/reading/queue/reorder", async (c) => {
  const body = await c.req.json();
  queue.reorder(body.ids);
  return Response.json({ status: "reordered" });
});

app.get("/api/reading/dashboard", () => {
  return Response.json(db.getReadingDashboard());
});

app.post("/api/reading/finish/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const nextItemId = reading.finish(id.value);
  return Response.json({ status: "finished", next_item_id: nextItemId });
});

app.post("/api/reading/drop/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  reading.drop(id.value);
  return Response.json({ status: "dropped" });
});

// Stub endpoints (Phase 5 integrations - not yet implemented)

app.post("/api/reading/sync-focusd", () => {
  return Response.json({ error: "FocusD integration not implemented" }, {
    status: 501,
  });
});

app.get("/api/reading/readest-status", () => {
  return Response.json({ enabled: false });
});

app.post("/api/reading/sync-readest", () => {
  return Response.json({ error: "Readest integration not implemented" }, {
    status: 501,
  });
});

app.post("/api/quit", async () => {
  // The desktop shell does not reliably exit when its window closes, so
  // offer an explicit quit: respond first, then terminate the process.
  // The single-instance pidfile is removed so the next launch starts clean.
  await application.shutdown("api/quit");
  setTimeout(async () => {
    try {
      await Deno.remove(pidFile);
    } catch { /* non-fatal */ }
    Deno.exit(0);
  }, 200);
  return Response.json({ status: "quitting" });
});

app.post("/api/scan", async (c) => {
  let dirs = settings.scanDirectories();
  let force = false;
  try {
    const body = await c.req.json();
    if (body.dirs) dirs = body.dirs;
    if (body.force) force = body.force;
  } catch {
    // No body sent — use defaults
  }
  let total = 0;
  const result = await scanning.scan(dirs, (_current, t) => {
    total = t;
  }, force);
  return match(result, {
    ok: ({ indexed, removed, moved }) =>
      Response.json({ indexed, removed, moved, total }),
    err: (e) =>
      Response.json(
        { error: e.message },
        { status: e.code === "NOT_FOUND" ? 404 : 500 },
      ),
  });
});

app.get("/api/items/:id/content-index", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const item = library.item(id.value);
  if (!item.ok) return respond(item);
  return Response.json(library.contentIndexState(id.value));
});

app.post("/api/items/:id/content-index", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const item = library.item(id.value);
  if (!item.ok) return respond(item);
  const body = await c.req.json().catch(() => ({}));
  const ocr = Boolean(body && typeof body === "object" && "ocr" in body && body.ocr);
  const extracted = await extractDocumentContent(item.value, ocr);
  const saved = library.replaceDocumentContent(
    id.value,
    item.value.content_hash ?? "",
    extracted.status,
    extracted.chunks,
    extracted.error,
  );
  if (!saved.ok) return respond(saved);
  return Response.json({
    status: extracted.status,
    chunks: extracted.chunks.length,
    error: extracted.error ?? "",
  });
});

// Static file serving for frontend

const staticDir = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "..",
  "web",
  "static",
);
const webDevUrl = Deno.env.get("LIBRARY_WEB_DEV_URL")?.replace(/\/$/, "");

app.get("/*", async (c) => {
  const path = c.req.path;
  if (webDevUrl) {
    try {
      const upstream = await fetch(`${webDevUrl}${path}${c.req.url.includes("?") ? new URL(c.req.url).search : ""}`);
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    } catch {
      return new Response("The Vite development server is unavailable.", { status: 503 });
    }
  }

  const filePath = join(staticDir, path === "/" ? "index.html" : path);
  try {
    const file = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop() ?? "";
    const mimeTypes: Record<string, string> = {
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
      mjs: "application/javascript",
      wasm: "application/wasm",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      woff: "font/woff",
      woff2: "font/woff2",
    };
    return new Response(file, {
      headers: { "content-type": mimeTypes[ext] ?? "application/octet-stream" },
    });
  } catch {
    // SPA fallback - serve index.html for non-file routes
    try {
      const indexPath = join(staticDir, "index.html");
      const file = await Deno.readFile(indexPath);
      return new Response(file, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
});

// Single-instance guard: closing the desktop window does not always stop
// the background server (upstream webview rough edge), so stale instances
// pile up — each running the code from when it was launched, which makes
// "relaunch to get the fix" silently open the old build. A new instance
// therefore terminates any predecessor before serving.
const pidDir = join(appCacheRoot(), "library");
const pidFile = join(pidDir, "library.pid");
application.setPidFile(pidFile);
const instanceStartedAt = performance.now();
try {
  await Deno.mkdir(pidDir, { recursive: true });
  const prev = parseInt((await Deno.readTextFile(pidFile)).trim(), 10);
  if (Number.isFinite(prev) && prev !== Deno.pid) {
    try {
      Deno.kill(prev, "SIGTERM");
      // The application shutdown path is synchronous apart from pid cleanup;
      // a short grace period avoids adding a full second to every stale-window
      // recovery while still allowing SQLite sessions to close cleanly.
      await new Promise((r) => setTimeout(r, 250));
      try {
        Deno.kill(prev, "SIGKILL");
      } catch { /* exited after TERM */ }
      console.log(`Terminated previous instance (pid ${prev})`);
    } catch { /* already gone */ }
  }
} catch { /* no pid file yet */ }
try {
  await Deno.writeTextFile(pidFile, String(Deno.pid));
} catch { /* non-fatal */ }
application.recordStage(
  "single_instance",
  performance.now() - instanceStartedAt,
);

const port = parseInt(Deno.args[0] ?? "3000");
const addr = Deno.env.get("DENO_SERVE_ADDRESS");
const actualPort = addr ? parseInt(addr.split(":").pop()!) : port;
console.log(`Library server running on http://localhost:${actualPort}`);
application.transition("HttpReady");
application.transition("Ready");
const server = Deno.serve({ port }, app.fetch);
application.recordStage("module_to_http", performance.now() - moduleStartedAt);
application.transition("Running");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void application.shutdown(signal).finally(() => server.shutdown());
  });
}

// Close the desktop app when the window is closed (SUPER+W, titlebar X, etc.)
// The Deno 2.9.6 desktop runtime cannot complete a native close request on its
// own (denoland/deno#36715: laufey 0.7.0 defers the close and the CEF backend
// never finishes it), so the shell event is only a notification — this side
// must exit the process. The first BrowserWindow constructed adopts the
// shell's initial window; its "close" event is that close request.
interface DesktopRuntime {
  BrowserWindow?: new () => {
    windowId: number;
    addEventListener(type: "close", listener: () => void): void;
  };
}
const desktop = Deno as unknown as DesktopRuntime;
if (typeof desktop.BrowserWindow === "function") {
  const win = new desktop.BrowserWindow();
  // Adopting the window also makes us its close-requested handler, so the
  // runtime routes SUPER+W / titlebar-X here; exiting the process closes it.
  win.addEventListener("close", () => {
    void application.shutdown("window-close");
    setTimeout(() => {
      try {
        Deno.remove(pidFile);
      } catch { /* non-fatal */ }
      Deno.exit(0);
    }, 200);
  });
}
