import { assertEquals, assertExists } from "@std/assert";
import { DB } from "../src/db.ts";
import type { ItemUpdate, SearchQuery } from "../src/types.ts";

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

Deno.test("deleteItem removes existing item", () => {
  const db = new DB(":memory:");

  db.connection.prepare(`
    INSERT INTO items (title, path, filename) VALUES (?, ?, ?)
  `).run("To Delete", "/tmp/del.pdf", "del.pdf");

  const result = db.deleteItem(1);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, true);

  const item = db.getItem(1);
  assertEquals(item.ok, false);

  db.close();
});

Deno.test("deleteItem returns false for missing id", () => {
  const db = new DB(":memory:");
  const result = db.deleteItem(999);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value, false);
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

  db.connection.prepare("INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)").run("A1", "/a.pdf", "a.pdf", "cs");
  db.connection.prepare("INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)").run("A2", "/b.pdf", "b.pdf", "cs");
  db.connection.prepare("INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)").run("A3", "/c.pdf", "c.pdf", "math");

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

  db.connection.prepare("INSERT INTO items (title, path, filename, category) VALUES (?, ?, ?, ?)").run("A", "/a.pdf", "a.pdf", "cs");
  db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run("B", "/b.pdf", "b.pdf");

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

  db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run("A", "/a.pdf", "a.pdf");
  db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run("B", "/b.pdf", "b.pdf");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)").run(1, "ml");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)").run(1, "ai");
  db.connection.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)").run(2, "ml");

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

  db.connection.prepare("INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)").run("A", "/a.pdf", "a.pdf", "reference");
  db.connection.prepare("INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)").run("B", "/b.pdf", "b.pdf", "reference");
  db.connection.prepare("INSERT INTO items (title, path, filename, purpose) VALUES (?, ?, ?, ?)").run("C", "/c.pdf", "c.pdf", "textbook");

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

  db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run("A", "/a.pdf", "a.pdf");
  db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run("B", "/b.pdf", "b.pdf");

  const q: SearchQuery = { q: "", type: "", category: "", tag: "", purpose: "", year: 0, sort: "", order: "", page: 1, limit: 20 };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.total, 2);
    assertEquals(result.value.items.length, 2);
    assertEquals(result.value.total_pages, 1);
  }

  db.close();
});

Deno.test("search filters by type", () => {
  const db = new DB(":memory:");

  db.connection.prepare("INSERT INTO items (title, path, filename, type) VALUES (?, ?, ?, ?)").run("A", "/a.pdf", "a.pdf", "book");
  db.connection.prepare("INSERT INTO items (title, path, filename, type) VALUES (?, ?, ?, ?)").run("B", "/b.pdf", "b.pdf", "paper");

  const q: SearchQuery = { q: "", type: "book", category: "", tag: "", purpose: "", year: 0, sort: "", order: "", page: 1, limit: 20 };
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
    db.connection.prepare("INSERT INTO items (title, path, filename) VALUES (?, ?, ?)").run(`Item ${i}`, `/item${i}.pdf`, `item${i}.pdf`);
  }

  const q: SearchQuery = { q: "", type: "", category: "", tag: "", purpose: "", year: 0, sort: "", order: "", page: 1, limit: 10 };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.total, 25);
    assertEquals(result.value.items.length, 10);
    assertEquals(result.value.page, 1);
    assertEquals(result.value.total_pages, 3);
  }

  const q2: SearchQuery = { q: "", type: "", category: "", tag: "", purpose: "", year: 0, sort: "", order: "", page: 3, limit: 10 };
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

  db.connection.prepare("INSERT INTO items (title, path, filename, year) VALUES (?, ?, ?, ?)").run("Old", "/old.pdf", "old.pdf", 2010);
  db.connection.prepare("INSERT INTO items (title, path, filename, year) VALUES (?, ?, ?, ?)").run("New", "/new.pdf", "new.pdf", 2024);

  const q: SearchQuery = { q: "", type: "", category: "", tag: "", purpose: "", year: 0, sort: "year", order: "desc", page: 1, limit: 20 };
  const result = db.search(q);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.items[0]!.title, "New");
    assertEquals(result.value.items[1]!.title, "Old");
  }

  db.close();
});
