import { Hono } from "hono";
import { DB } from "./db.ts";
import { openFile } from "./open.ts";
import { scanDirectory } from "./scanner.ts";
import { match } from "./result.ts";
import type { Result } from "./result.ts";
import { AppError } from "./result.ts";
import {
  ItemUpdateSchema,
  SearchQuerySchema,
  IdParamSchema,
} from "./validate.ts";
import { dirname, join, fromFileUrl } from "@std/path";

const app = new Hono();
const db = new DB();

function respond<T>(result: Result<T>): Response {
  return match(result, {
    ok: (data) => Response.json(data),
    err: (e) => Response.json(
      { error: e.message },
      { status: e.code === "NOT_FOUND" ? 404 : 500 }
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
  return c.json({ status: "ok", fts: db.fts, version: "1.0.0" });
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
  return respond(db.updateItem(id.value, parsed.data));
});

app.delete("/api/items/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(db.deleteItem(id.value)) : respond(id);
});

app.on(["GET", "POST"], "/api/open/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(openFile(db, id.value)) : respond(id);
});

app.get("/api/file/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id.ok) return Response.json({ error: "invalid id" }, { status: 400 });
  const item = db.getItem(id.value);
  if (!item.ok) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const file = await Deno.readFile(item.value.path);
    const ext = item.value.filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      epub: "application/epub+zip",
      mobi: "application/x-mobipocket-ebook",
      djvu: "image/vnd.djvu",
    };
    return new Response(file, {
      headers: { "content-type": mimeTypes[ext] ?? "application/octet-stream" },
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
    return Response.json({ item_id: id.value, status: "unread", progress_percent: 0, current_page: 0, total_pages: 0, started_at: null, finished_at: null, last_read_at: null, updated_at: new Date().toISOString() });
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
  if (!session) return Response.json({ error: "no active session" }, { status: 404 });
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
  return Response.json({ error: "FocusD integration not implemented" }, { status: 501 });
});

app.get("/api/reading/readest-status", () => {
  return Response.json({ enabled: false });
});

app.post("/api/reading/sync-readest", () => {
  return Response.json({ error: "Readest integration not implemented" }, { status: 501 });
});

app.post("/api/scan", async (c) => {
  const body = await c.req.json();
  const dirs = body.dirs as string[];
  const force = body.force as boolean;
  const result = await scanDirectory(db, dirs, undefined, force);
  return respond(result);
});

// Static file serving for frontend

const staticDir = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "web", "static");

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

const port = parseInt(Deno.args[0] ?? "3000");
const addr = Deno.env.get("DENO_SERVE_ADDRESS");
const actualPort = addr ? parseInt(addr.split(":").pop()!) : port;
console.log(`Library server running on http://localhost:${actualPort}`);

Deno.serve({ port }, app.fetch);
