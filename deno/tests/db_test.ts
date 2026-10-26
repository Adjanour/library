import { assert, assertEquals, assertExists } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { DB } from "../src/db.ts";
import type { Item, ItemUpdate, SearchQuery } from "../src/types.ts";

Deno.test("schema creates all tables", () => {
  const db = new DB(":memory:");

  const tables = db.connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];

  const names = tables.map((t) => t.name);
  assertExists(names.includes("items"));
  assertExists(names.includes("item_tags"));
  assertExists(names.includes("reading_progress"));
  assertExists(names.includes("reading_sessions"));
  assertExists(names.includes("reading_queue"));
  assertExists(names.includes("app_settings"));

  db.close();
});

Deno.test("legacy database migrates idempotently and keeps a backup", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/library.db`;
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      authors TEXT DEFAULT '',
      year INTEGER DEFAULT 0,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      category TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  legacy.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Legacy title", "/tmp/legacy.pdf", "legacy.pdf");
  legacy.close();

  const db = new DB(path);
  const version = db.connection.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  assertEquals(version.user_version, 5);
  const item = db.getItem(1);
  assert(item.ok);
  if (item.ok) {
    assertEquals(item.value.title, "Legacy title");
    assertEquals(item.value.title_source, "metadata");
    assertEquals(item.value.ignored, 0);
  }
  db.close();

  const again = new DB(path);
  const againVersion = again.connection.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  assertEquals(againVersion.user_version, 5);
  assertEquals(again.getItem(1).ok, true);
  again.close();

  const backup = await Deno.stat(`${path}.bak-5`);
  assertEquals(backup.isFile, true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("application settings persist by key", () => {
  const db = new DB(":memory:");
  assertEquals(db.getSetting("scan_directories"), null);
  db.setSetting("scan_directories", JSON.stringify(["/books"]));
  assertEquals(db.getSetting("scan_directories"), '["/books"]');
  db.setSetting("scan_directories", JSON.stringify(["/books", "/papers"]));
  assertEquals(db.getSetting("scan_directories"), '["/books","/papers"]');
  db.close();
});

Deno.test("FTS5 is available", () => {
  const db = new DB(":memory:");
  assertEquals(db.fts, true);
  db.close();
});

Deno.test("foreign keys enforce cascade on delete", () => {
  const db = new DB(":memory:");

  db.connection
    .prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)")
    .run("Test Book", "/tmp/test.pdf", "test.pdf");

  db.connection
    .prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)")
    .run(1, "test");

  db.connection.prepare("DELETE FROM items WHERE id = ?").run(1);

  const tags = db.connection
    .prepare("SELECT COUNT(*) as count FROM item_tags")
    .get() as { count: number };

  assertEquals(tags.count, 0);
  db.close();
});

Deno.test("UPSERT works for items", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename, size)
    VALUES (?, ?, ?, ?)
  `).run("Original", "/tmp/test.pdf", "test.pdf", 100);

  db.connection.prepare(`
    INSERT INTO items (title, path, filename, size)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      size = excluded.size
  `).run("Updated", "/tmp/test.pdf", "test.pdf", 200);

  const item = db.connection
    .prepare("SELECT title, size FROM items WHERE path = ?")
    .get("/tmp/test.pdf") as { title: string; size: number };

  assertEquals(item.title, "Updated");
  assertEquals(item.size, 200);

  const count = db.connection
    .prepare("SELECT COUNT(*) as c FROM items")
    .get() as { c: number };

  assertEquals(count.c, 1);

  db.close();
});

Deno.test("FTS5 triggers sync on insert", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename) VALUES (?, ?, ?)
  `).run("Attention Is All You Need", "/tmp/attention.pdf", "attention.pdf");

  const results = db.connection.prepare(`
    SELECT rowid FROM items_fts WHERE items_fts MATCH 'attention'
  `).all() as { rowid: number }[];

  assertEquals(results.length, 1);
  assertEquals(results[0]!.rowid, 1);

  db.close();
});

Deno.test("getItem returns item by id", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, authors, year, path, filename, type, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "Deep Learning",
    "Goodfellow",
    2016,
    "/tmp/dl.pdf",
    "dl.pdf",
    "book",
    "cs",
  );

  const result = db.getItem(1);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.title, "Deep Learning");
    assertEquals(result.value.authors, "Goodfellow");
    assertEquals(result.value.year, 2016);
    assertEquals(result.value.type, "book");
  }

  db.close();
});

Deno.test("getItem returns NotFound for missing id", () => {
  const db = new DB(":memory:");
  const result = db.getItem(999);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.code, "NOT_FOUND");
  }
  db.close();
});

Deno.test("deleteItem ignores an item without deleting its row", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename) VALUES (?, ?, ?)
  `).run("To Delete", "/tmp/del.pdf", "del.pdf");

  const result = db.deleteItem(1);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, true);

  const item = db.getItem(1);
  assertEquals(item.ok, true);
  if (item.ok) assertEquals(item.value.ignored, 1);
  const result2 = db.search({
    q: "To Delete", type: "", category: "", tag: "", purpose: "", year: 0,
    sort: "", order: "", page: 1, limit: 20,
  });
  assertEquals(result2.ok, true);
  if (result2.ok) assertEquals(result2.value.total, 0);

  db.close();
});

Deno.test("manual metadata stays locked across scanner upserts", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, authors, path, filename) VALUES (?, ?, ?, ?)",
  ).run("Original", "Original Author", "/tmp/locked.pdf", "locked.pdf");
  assertEquals(db.updateItem(1, { title: "Corrected", authors: "Me" }).ok, true);

  const result = db.upsertItem({
    id: 1,
    title: "Scanner Guess",
    authors: "Scanner Author",
    year: 2024,
    path: "/tmp/locked.pdf",
    filename: "locked.pdf",
    type: "book",
    category: "research",
    tags: "guide",
    purpose: "reading",
    description: "Scanner description",
    size: 123,
  } as Item);
  assertEquals(result.ok, true);
  const item = db.getItem(1);
  assert(item.ok);
  if (item.ok) {
    assertEquals(item.value.title, "Corrected");
    assertEquals(item.value.authors, "Me");
    assertEquals(item.value.category, "research");
  }
  db.close();
});

Deno.test("deleteItem returns false for missing id", () => {
  const db = new DB(":memory:");
  const result = db.deleteItem(999);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, false);
  db.close();
});

Deno.test("ignored items can be restored", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Restorable", "/tmp/restorable.pdf", "restorable.pdf");
  assertEquals(db.deleteItem(1).ok, true);
  assertEquals(db.restoreItem(1).ok, true);
  const result = db.search({
    q: "Restorable", type: "", category: "", tag: "", purpose: "", year: 0,
    sort: "", order: "", page: 1, limit: 20,
  });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.total, 1);
  db.close();
});

Deno.test("updateItem updates single field", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename) VALUES (?, ?, ?)
  `).run("Old Title", "/tmp/test.pdf", "test.pdf");

  const result = db.updateItem(1, { title: "New Title" });
  assertEquals(result.ok, true);

  const item = db.getItem(1);
  assertEquals(item.ok, true);
  if (item.ok) assertEquals(item.value.title, "New Title");

  db.close();
});

Deno.test("updateItem updates multiple fields", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, authors, path, filename) VALUES (?, ?, ?, ?)
  `).run("Old", "Nobody", "/tmp/test.pdf", "test.pdf");

  const result = db.updateItem(1, { title: "New", authors: "Somebody" });
  assertEquals(result.ok, true);

  const item = db.getItem(1);
  assertEquals(item.ok, true);
  if (item.ok) {
    assertEquals(item.value.title, "New");
    assertEquals(item.value.authors, "Somebody");
  }

  db.close();
});

Deno.test("updateItem returns Validation when no fields provided", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename) VALUES (?, ?, ?)
  `).run("Title", "/tmp/test.pdf", "test.pdf");

  const result = db.updateItem(1, {});
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.code, "VALIDATION");
  }

  db.close();
});

Deno.test("getCategories returns counts grouped by category", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
  ).run("A1", "/a.pdf", "a.pdf", "cs");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
  ).run("A2", "/b.pdf", "b.pdf", "cs");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
  ).run("A3", "/c.pdf", "c.pdf", "math");

  const result = db.getCategories();
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.length, 2);
    assertEquals(result.value[0]!.name, "cs");
    assertEquals(result.value[0]!.count, 2);
    assertEquals(result.value[1]!.name, "math");
    assertEquals(result.value[1]!.count, 1);
  }

  db.close();
});

Deno.test("getCategories excludes empty categories", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
  ).run("A", "/a.pdf", "a.pdf", "cs");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("B", "/b.pdf", "b.pdf");

  const result = db.getCategories();
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.length, 1);
    assertEquals(result.value[0]!.name, "cs");
  }

  db.close();
});

Deno.test("getTags returns counts from item_tags", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("A", "/a.pdf", "a.pdf");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("B", "/b.pdf", "b.pdf");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)")
    .run(1, "ml");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)")
    .run(1, "ai");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)")
    .run(2, "ml");

  const result = db.getTags();
  assertEquals(result.ok, true);
  if (result.ok) {
    const ml = result.value.find((t) => t.name === "ml");
    assertExists(ml);
    assertEquals(ml!.count, 2);
    const ai = result.value.find((t) => t.name === "ai");
    assertExists(ai);
    assertEquals(ai!.count, 1);
  }

  db.close();
});

Deno.test("getPurposes returns counts grouped by purpose", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)",
  ).run("A", "/a.pdf", "a.pdf", "reference");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)",
  ).run("B", "/b.pdf", "b.pdf", "reference");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)",
  ).run("C", "/c.pdf", "c.pdf", "textbook");

  const result = db.getPurposes();
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value[0]!.name, "reference");
    assertEquals(result.value[0]!.count, 2);
  }

  db.close();
});

Deno.test("search returns all items with empty query", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("A", "/a.pdf", "a.pdf");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("B", "/b.pdf", "b.pdf");

  const q: SearchQuery = {
    q: "",
    type: "",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "",
    order: "",
    page: 1,
    limit: 20,
  };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.total, 2);
    assertEquals(result.value.items.length, 2);
    assertEquals(result.value.total_pages, 1);
  }

  db.close();
});

Deno.test("search treats punctuation in titles as text instead of FTS syntax", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  )
    .run("A Common-Sense Guide: Data Structures", "/guide.epub", "guide.epub");

  const result = db.search({
    q: "Common-Sense Guide:",
    type: "",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "",
    order: "",
    page: 1,
    limit: 20,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.items.map((item) => item.title), [
      "A Common-Sense Guide: Data Structures",
    ]);
  }
  db.close();
});

Deno.test("search filters by type", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename, type) VALUES (?, ?, ?, ?)",
  ).run("A", "/a.pdf", "a.pdf", "book");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, type) VALUES (?, ?, ?, ?)",
  ).run("B", "/b.pdf", "b.pdf", "paper");

  const q: SearchQuery = {
    q: "",
    type: "book",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "",
    order: "",
    page: 1,
    limit: 20,
  };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.total, 1);
    assertEquals(result.value.items[0]!.type, "book");
  }

  db.close();
});

Deno.test("search paginates results", () => {
  const db = new DB(":memory:");

  for (let i = 0; i < 25; i++) {
    db.connection.prepare(
      "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
    ).run(`Item ${i}`, `/item${i}.pdf`, `item${i}.pdf`);
  }

  const q: SearchQuery = {
    q: "",
    type: "",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "",
    order: "",
    page: 1,
    limit: 10,
  };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.total, 25);
    assertEquals(result.value.items.length, 10);
    assertEquals(result.value.page, 1);
    assertEquals(result.value.total_pages, 3);
  }

  const q2: SearchQuery = {
    q: "",
    type: "",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "",
    order: "",
    page: 3,
    limit: 10,
  };
  const result2 = db.search(q2);
  assertEquals(result2.ok, true);
  if (result2.ok) {
    assertEquals(result2.value.items.length, 5);
    assertEquals(result2.value.page, 3);
  }

  db.close();
});

Deno.test("search sorts by year descending", () => {
  const db = new DB(":memory:");

  db.connection.prepare(
    "INSERT INTO items (title, path, filename, year) VALUES (?, ?, ?, ?)",
  ).run("Old", "/old.pdf", "old.pdf", 2010);
  db.connection.prepare(
    "INSERT INTO items (title, path, filename, year) VALUES (?, ?, ?, ?)",
  ).run("New", "/new.pdf", "new.pdf", 2024);

  const q: SearchQuery = {
    q: "",
    type: "",
    category: "",
    tag: "",
    purpose: "",
    year: 0,
    sort: "year",
    order: "desc",
    page: 1,
    limit: 20,
  };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.items[0]!.title, "New");
    assertEquals(result.value.items[1]!.title, "Old");
  }

  db.close();
});

Deno.test("reading progress derives status from actual progress", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Progress Book", "/tmp/progress.pdf", "progress.pdf");

  db.upsertReadingProgress({
    item_id: 1,
    status: "finished",
    progress_percent: 25,
    current_page: 5,
    total_pages: 20,
    started_at: null,
    finished_at: null,
    last_read_at: null,
    updated_at: new Date().toISOString(),
  });
  assertEquals(db.getReadingProgress(1)?.status, "reading");
  assertEquals(db.getReadingProgress(1)?.progress_percent, 25);

  db.upsertReadingProgress({
    item_id: 1,
    status: "unread",
    progress_percent: 100,
    current_page: 20,
    total_pages: 20,
    started_at: null,
    finished_at: null,
    last_read_at: null,
    updated_at: new Date().toISOString(),
  });
  assertEquals(db.getReadingProgress(1)?.status, "finished");
  assertEquals(db.getReadingProgress(1)?.finished_at !== null, true);
  db.close();
});

Deno.test("atomic progress keeps furthest progress when the reader moves backwards", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Monotonic Book", "/tmp/monotonic.pdf", "monotonic.pdf");

  const first = db.recordReadingProgress(1, {
    progress_percent: 60,
    current_page: 12,
    total_pages: 20,
    location: "epubcfi(/6/10)",
  });
  assertEquals(first.progress_percent, 60);
  assertEquals(first.status, "reading");
  assertEquals(first.location, "epubcfi(/6/10)");

  const backwards = db.recordReadingProgress(1, {
    progress_percent: 20,
    current_page: 4,
    total_pages: 20,
    location: "epubcfi(/6/4)",
  });
  assertEquals(backwards.progress_percent, 60);
  assertEquals(backwards.current_page, 4);
  assertEquals(backwards.location, "epubcfi(/6/4)");
  assertEquals(backwards.status, "reading");
  db.close();
});

Deno.test("atomic progress cannot undo a finished book", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Finished Monotonic Book", "/tmp/finished-monotonic.pdf", "finished-monotonic.pdf");

  db.recordReadingProgress(1, {
    progress_percent: 100,
    current_page: 20,
    total_pages: 20,
  });
  const stale = db.recordReadingProgress(1, {
    progress_percent: 80,
    current_page: 16,
    total_pages: 20,
  });
  assertEquals(stale.status, "finished");
  assertEquals(stale.progress_percent, 100);
  db.close();
});

Deno.test("starting a session does not create reading progress", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Session Book", "/tmp/session.pdf", "session.pdf");
  db.startReadingSession(1);
  assertEquals(db.getReadingProgress(1), null);
  db.close();
});

Deno.test("sessions expose activity and orphan cleanup closes stale sessions", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Session Lifecycle Book", "/tmp/session-lifecycle.pdf", "session-lifecycle.pdf");

  const session = db.startReadingSession(1);
  assertExists(session.last_activity_at);
  assertEquals(db.touchReadingSession(1), true);
  db.connection.prepare(
    "UPDATE reading_sessions SET last_activity_at = datetime('now', '-10 seconds') WHERE id = ?",
  ).run(session.id);
  assertEquals(db.touchReadingSession(1), true);
  const active = db.connection.prepare(
    "SELECT duration_seconds FROM reading_sessions WHERE id = ?",
  ).get(session.id) as { duration_seconds: number };
  assertEquals(active.duration_seconds >= 9, true);
  db.connection.prepare(
    "UPDATE reading_sessions SET last_activity_at = datetime('now', '-2 hours') WHERE id = ?",
  ).run(session.id);
  assertEquals(db.closeOrphanedSessions(30), 1);
  const closed = db.getReadingSessions(1, 1)[0];
  assertExists(closed?.ended_at);
  db.close();
});

Deno.test("bookmarks persist by item and location", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Bookmark Book", "/tmp/bookmark.epub", "bookmark.epub");

  const created = db.addBookmark(1, "epubcfi(/6/2)", "Chapter one", 12);
  assertEquals(created.location, "epubcfi(/6/2)");
  assertEquals(db.addBookmark(1, "epubcfi(/6/2)", "Updated label", 14).id, created.id);
  assertEquals(db.getBookmarks(1)[0]?.label, "Updated label");
  assertEquals(db.removeBookmark(1, "epubcfi(/6/2)"), true);
  assertEquals(db.getBookmarks(1).length, 0);
  db.close();
});

Deno.test("finishing a book creates durable finished progress", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Finished Book", "/tmp/finished.pdf", "finished.pdf");
  db.finishReading(1);
  const progress = db.getReadingProgress(1);
  assertEquals(progress?.status, "finished");
  assertEquals(progress?.progress_percent, 100);
  db.close();
});

Deno.test("search cursor continues without duplicating rows and returns facets", () => {
  const db = new DB(":memory:");
  for (const [title, category] of [["Same title A", "research"], ["Same title B", "research"], ["Another title", "learning"]] as const) {
    db.connection.prepare(
      "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
    ).run(title, `/${title}.pdf`, `${title}.pdf`, category);
  }
  const query = {
    q: "", type: "", category: "", tag: "", purpose: "", year: 0,
    sort: "", order: "", page: 1, limit: 1,
  };
  const first = db.search(query);
  assert(first.ok);
  if (first.ok) {
    assertEquals(first.value.items.length, 1);
    assertEquals(first.value.next_cursor !== null, true);
    const second = db.search({ ...query, cursor: first.value.next_cursor ?? undefined });
    assert(second.ok);
    if (second.ok) {
      assertEquals(second.value.items.length, 1);
      assertEquals(second.value.items[0]!.id !== first.value.items[0]!.id, true);
      const research = second.value.facets?.category.find((facet) => facet.name === "research");
      assertEquals(research?.count, 2);
    }
  }
  db.close();
});

Deno.test("bulk metadata edits can be undone as one batch", () => {
  const db = new DB(":memory:");
  for (const [title, path] of [["First", "/tmp/first.pdf"], ["Second", "/tmp/second.pdf"]] as const) {
    db.connection.prepare(
      "INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)",
    ).run(title, path, `${title.toLowerCase()}.pdf`, "old");
  }
  const updated = db.bulkUpdateItems([1, 2], { category: "research" });
  assert(updated.ok);
  if (updated.ok) {
    const changed = db.getItem(1);
    assert(changed.ok);
    if (changed.ok) assertEquals(changed.value.category, "research");
    const undone = db.undoEdits(updated.value.batch_id);
    assert(undone.ok);
    const first = db.getItem(1);
    const second = db.getItem(2);
    assert(first.ok && second.ok);
    if (first.ok && second.ok) {
      assertEquals(first.value.category, "old");
      assertEquals(second.value.category, "old");
    }
  }
  db.close();
});

Deno.test("dropping a book creates an explicit dropped state", () => {
  const db = new DB(":memory:");
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Dropped", "/tmp/dropped.pdf", "dropped.pdf");
  db.dropReading(1);
  assertEquals(db.getReadingProgress(1)?.status, "dropped");
  db.close();
});
