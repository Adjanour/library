import { Hono } from "hono";
import { DB } from "./db.ts";
import { openFile } from "./open.ts";
import { scanDirectory } from "./scanner.ts";
import { match } from "./result.ts";
import type { Result } from "./result.ts";
import { AppError } from "./result.ts";
import {
  IdParamSchema,
  ItemUpdateSchema,
  ReaderPreferencesSchema,
  SearchQuerySchema,
  SettingsSchema,
} from "./validate.ts";
import { dirname, fromFileUrl, isAbsolute, join, normalize } from "@std/path";
import { appCacheRoot, defaultScanDirectories } from "./platform.ts";

const app = new Hono();
const db = new DB();
const APP_VERSION = "0.1.1-dev";
const epubDiagnostics: Array<Record<string, unknown>> = [];

const DEFAULT_SCAN_DIRS = defaultScanDirectories();

function configuredScanDirectories(): string[] {
  const raw = db.getSetting("scan_directories");
  if (!raw) return DEFAULT_SCAN_DIRS;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.length > 0 ? value : DEFAULT_SCAN_DIRS;
  } catch {
    return DEFAULT_SCAN_DIRS;
  }
}

function configuredReaderPreferences() {
  const raw = db.getSetting("reader_preferences");
  if (!raw) return undefined;
  try {
    const parsed = ReaderPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

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
  return c.json({ status: "ok", fts: db.fts, version: APP_VERSION });
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
  });
  if (!result.success) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return respond(db.search(result.data));
});

app.get("/api/stats", () => respond(db.getStats()));
app.get("/api/categories", () => respond(db.getCategories()));
app.get("/api/tags", () => respond(db.getTags()));
app.get("/api/purposes", () => respond(db.getPurposes()));

app.get("/api/settings", () =>
  Response.json({
    scan_directories: configuredScanDirectories(),
    platform: Deno.build.os,
    version: APP_VERSION,
    smoke_item_id: Number(Deno.env.get("LIBRARY_EPUB_SMOKE_ID")) || undefined,
    reading_preferences: configuredReaderPreferences(),
  }));

app.put("/api/settings/reading", async (c) => {
  const parsed = ReaderPreferencesSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  db.setSetting("reader_preferences", JSON.stringify(parsed.data));
  return Response.json(parsed.data);
});

app.get("/api/diagnostics/epub", () => Response.json(epubDiagnostics));

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
  const directories = [
    ...new Set(
      parsed.data.scan_directories.map((path) => normalize(path.trim())),
    ),
  ];
  for (const path of directories) {
    if (!isAbsolute(path)) {
      return Response.json({
        error: `Scan folders must be absolute paths: ${path}`,
      }, { status: 400 });
    }
    try {
      const info = await Deno.stat(path);
      if (!info.isDirectory) {
        return Response.json({ error: `Not a folder: ${path}` }, {
          status: 400,
        });
      }
    } catch {
      return Response.json({
        error: `Folder does not exist or cannot be read: ${path}`,
      }, { status: 400 });
    }
  }
  db.setSetting("scan_directories", JSON.stringify(directories));
  return Response.json({
    scan_directories: directories,
    platform: Deno.build.os,
    version: APP_VERSION,
  });
});

app.get("/api/items/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(db.getItem(id.value)) : respond(id);
});

app.put("/api/items/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);

  const body = await c.req.json();
  const parsed = ItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const result = db.updateItem(id.value, parsed.data);
  if (!result.ok) return respond(result);
  return respond(db.getItem(id.value));
});

app.delete("/api/items/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(db.deleteItem(id.value)) : respond(id);
});

app.on(["GET", "POST"], "/api/open/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(openFile(db, id.value)) : respond(id);
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
  const item = db.getItem(id.value);
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

app.get("/api/file/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return Response.json({ error: "invalid id" }, { status: 400 });
  const item = db.getItem(id.value);
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
  const body = await c.req.json();
  db.upsertReadingProgress({ ...body, item_id: id.value });
  return Response.json({ status: "updated" });
});

app.post("/api/reading/start/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  const session = db.startReadingSession(id.value);
  return Response.json(session);
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
  return Response.json(db.getReadingQueue());
});

app.post("/api/reading/queue", async (c) => {
  const body = await c.req.json();
  db.addToReadingQueue(body);
  return Response.json(body);
});

app.delete("/api/reading/queue/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  db.removeFromReadingQueue(id.value);
  return Response.json({ status: "removed" });
});

app.post("/api/reading/queue/reorder", async (c) => {
  const body = await c.req.json();
  db.reorderReadingQueue(body.ids);
  return Response.json({ status: "reordered" });
});

app.get("/api/reading/dashboard", () => {
  return Response.json(db.getReadingDashboard());
});

app.post("/api/reading/finish/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return respond(id);
  db.finishReading(id.value);
  return Response.json({ status: "finished" });
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

app.post("/api/quit", () => {
  // The desktop shell does not reliably exit when its window closes, so
  // offer an explicit quit: respond first, then terminate the process.
  // The single-instance pidfile is removed so the next launch starts clean.
  setTimeout(async () => {
    try {
      await Deno.remove(pidFile);
    } catch { /* non-fatal */ }
    Deno.exit(0);
  }, 200);
  return Response.json({ status: "quitting" });
});

app.post("/api/scan", async (c) => {
  let dirs = configuredScanDirectories();
  let force = false;
  try {
    const body = await c.req.json();
    if (body.dirs) dirs = body.dirs;
    if (body.force) force = body.force;
  } catch {
    // No body sent — use defaults
  }
  let total = 0;
  const result = await scanDirectory(db, dirs, (_current, t) => {
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

// Static file serving for frontend

const staticDir = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "..",
  "web",
  "static",
);

app.get("/*", async (c) => {
  const path = c.req.path;

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
try {
  await Deno.mkdir(pidDir, { recursive: true });
  const prev = parseInt((await Deno.readTextFile(pidFile)).trim(), 10);
  if (Number.isFinite(prev) && prev !== Deno.pid) {
    try {
      Deno.kill(prev, "SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
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

const port = parseInt(Deno.args[0] ?? "3000");
const addr = Deno.env.get("DENO_SERVE_ADDRESS");
const actualPort = addr ? parseInt(addr.split(":").pop()!) : port;
console.log(`Library server running on http://localhost:${actualPort}`);

Deno.serve({ port }, app.fetch);
