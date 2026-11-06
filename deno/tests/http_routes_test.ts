import { assertEquals } from "@std/assert";
import { DB } from "../src/db.ts";
import { Application } from "../src/application/lifecycle.ts";
import { createRuntimeRoutes } from "../src/http/routes.ts";

function databaseWithItems(): DB {
  const db = new DB(":memory:");
  const insert = db.connection.prepare(
    "INSERT INTO items (title, path, filename, type) VALUES (?, ?, ?, ?)",
  );
  insert.run("First book", "/tmp/first.epub", "first.epub", "ebook");
  insert.run("Next book", "/tmp/next.epub", "next.epub", "ebook");
  return db;
}

Deno.test("HTTP bootstrap exposes the runtime contract", async () => {
  const db = new DB(":memory:");
  const application = new Application(db);
  application.transition("Ready");
  const app = createRuntimeRoutes(db, application, "test-version");
  const response = await app.request("http://library.test/api/bootstrap");
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    protocol_version: "1",
    app_version: "test-version",
    runtime_mode: "browser",
    platform: Deno.build.os,
    capabilities: {
      http: true,
      native_bindings: false,
      file_dialogs: false,
      notifications: false,
    },
    schema_version: 11,
    lifecycle_state: "Ready",
  });
  db.close();
});

Deno.test("HTTP reading commands preserve queue and progress invariants", async () => {
  const db = databaseWithItems();
  const application = new Application(db);
  const app = createRuntimeRoutes(db, application, "test-version");

  const invalid = await app.request(
    "http://library.test/api/reading/progress/1",
    {
      method: "POST",
      body: JSON.stringify({
        progress_percent: 101,
        current_page: 1,
        total_pages: 2,
      }),
      headers: { "content-type": "application/json" },
    },
  );
  assertEquals(invalid.status, 400);

  const queued = await app.request("http://library.test/api/reading/queue", {
    method: "POST",
    body: JSON.stringify({ item_id: 2, title: "Next book", author: "Author" }),
    headers: { "content-type": "application/json" },
  });
  assertEquals(queued.status, 201);

  const progress = await app.request(
    "http://library.test/api/reading/progress/1",
    {
      method: "POST",
      body: JSON.stringify({
        progress_percent: 60,
        current_page: 6,
        total_pages: 10,
        location: "chapter-1",
      }),
      headers: { "content-type": "application/json" },
    },
  );
  assertEquals((await progress.json()).progress_percent, 60);

  const backwards = await app.request(
    "http://library.test/api/reading/progress/1",
    {
      method: "POST",
      body: JSON.stringify({
        progress_percent: 20,
        current_page: 2,
        total_pages: 10,
      }),
      headers: { "content-type": "application/json" },
    },
  );
  assertEquals((await backwards.json()).progress_percent, 60);

  const finished = await app.request(
    "http://library.test/api/reading/finish/1",
    { method: "POST" },
  );
  assertEquals(await finished.json(), { status: "finished", next_item_id: 2 });
  assertEquals(db.getReadingQueue().length, 1);
  assertEquals(db.getReadingProgress(1)?.status, "finished");
  db.close();
});
