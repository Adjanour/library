import { Hono } from "hono";
import { DB } from "./db.ts";
import { openFile } from "./open.ts";
import { match } from "./result.ts";
import type { Result } from "./result.ts";
import { AppError } from "./result.ts";
import {
  ItemUpdateSchema,
  SearchQuerySchema,
  IdParamSchema,
} from "./validate.ts";

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

app.get("/api/open/:id", (c) => {
  const id = parseId(c.req.param("id"));
  return id.ok ? respond(openFile(db, id.value)) : respond(id);
});

const port = parseInt(Deno.args[0] ?? "8080");
console.log(`Library server running on http://localhost:${port}`);

Deno.serve({ port }, app.fetch);
