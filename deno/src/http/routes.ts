import { Hono } from "hono";
import type { Application } from "../application/lifecycle.ts";
import type { DB } from "../db.ts";
import {
  IdParamSchema,
  QueueItemSchema,
  QueueReorderSchema,
  ReadingProgressUpdateSchema,
} from "../validate.ts";
import { QueueService } from "../application/queue.ts";
import { ReadingService } from "../application/reading.ts";

function idParam(raw: string): number | null {
  const parsed = IdParamSchema.safeParse({ id: raw });
  return parsed.success ? parsed.data.id : null;
}

function invalid(message: string): Response {
  return Response.json({ error: message, code: "VALIDATION" }, { status: 400 });
}

export function createRuntimeRoutes(
  db: DB,
  application: Application,
  version: string,
) {
  const app = new Hono();
  const reading = new ReadingService(db);
  const queue = new QueueService(db);
  app.get("/api/bootstrap", () =>
    Response.json({
      protocol_version: "1",
      app_version: version,
      runtime_mode: Deno.env.get("LIBRARY_RUNTIME_MODE") === "desktop"
        ? "desktop"
        : "browser",
      platform: Deno.build.os,
      capabilities: {
        http: true,
        native_bindings: false,
        file_dialogs: false,
        notifications: false,
      },
      schema_version: db.schemaVersion,
      lifecycle_state: application.state,
    }));

  app.post("/api/reading/progress/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    const parsed = ReadingProgressUpdateSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return invalid(parsed.error.message);
    return Response.json(reading.progress(id, parsed.data));
  });

  app.post("/api/reading/start/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    return Response.json(reading.start(id));
  });

  app.post("/api/reading/heartbeat/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    return Response.json(reading.heartbeat(id));
  });

  app.post("/api/reading/finish/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    return Response.json({
      status: "finished",
      next_item_id: reading.finish(id),
    });
  });

  app.post("/api/reading/drop/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    reading.drop(id);
    return Response.json({ status: "dropped" });
  });

  app.get("/api/reading/queue", () => Response.json(queue.list()));
  app.post("/api/reading/queue", async (c) => {
    const parsed = QueueItemSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return invalid(parsed.error.message);
    queue.add(parsed.data);
    return Response.json(parsed.data, { status: 201 });
  });
  app.delete("/api/reading/queue/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id === null) return invalid("id must be a positive integer");
    queue.remove(id);
    return Response.json({ status: "removed" });
  });
  app.post("/api/reading/queue/reorder", async (c) => {
    const parsed = QueueReorderSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return invalid(parsed.error.message);
    queue.reorder(parsed.data.ids);
    return Response.json({ status: "reordered" });
  });
  return app;
}
