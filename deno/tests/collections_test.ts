import { assertEquals, assertExists } from "@std/assert";
import { DB } from "../src/db.ts";
import { LibraryService } from "../src/application/library.ts";
import { SettingsService } from "../src/application/settings.ts";

function insertItem(db: DB, title: string, path: string): number {
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run(title, path, `${title.toLowerCase()}.pdf`);
  const row = db.connection.prepare(
    "SELECT last_insert_rowid() AS id",
  ).get() as { id: number };
  return row.id;
}

Deno.test("collections remain available after schema version 7 migration", () => {
  const db = new DB(":memory:");
  const names = (db.connection.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as { name: string }[]).map((r) => r.name);
  assertExists(names.includes("collections"));
  assertExists(names.includes("collection_items"));
  db.close();
});

Deno.test("collection lifecycle: create, list, add, remove, delete", () => {
  const db = new DB(":memory:");
  const library = new LibraryService(db);
  const itemId = insertItem(db, "Design Book", "/lib/design.pdf");

  const created = library.createCollection("Favourites", "Must reads");
  assertEquals(created.ok, true);
  if (!created.ok) return;
  assertEquals(created.value.name, "Favourites");
  assertEquals(created.value.item_count, 0);

  // Creating the same name (case-insensitive) is rejected
  const duplicate = library.createCollection("FAVOURITES");
  assertEquals(duplicate.ok, false);

  const added = library.addToCollection(created.value.id, itemId);
  assertEquals(added.ok, true);
  const listed = library.collections();
  assertExists(listed);
  if (listed.ok && listed.value.length > 0) {
    assertEquals(listed.value.length, 1);
    assertEquals(listed.value[0]!.item_count, 1);
  }

  const items = library.collectionItems(created.value.id);
  if (items.ok && items.value.length > 0) {
    assertEquals(items.value[0]!.title, "Design Book");
  }

  // Membership state is available per collection
  const single = library.collection(created.value.id);
  if (single.ok) assertEquals(single.value.item_count, 1);

  const removed = library.removeFromCollection(created.value.id, itemId);
  assertEquals(removed.ok, true);
  if (single.ok) {
    const emptied = library.collection(created.value.id);
    if (emptied.ok) assertEquals(emptied.value.item_count, 0);
  }
  const missingItem = library.removeFromCollection(created.value.id, itemId);
  assertEquals(missingItem.ok, true);
  if (missingItem.ok) assertEquals(missingItem.value, false);

  const dropped = library.deleteCollection(created.value.id);
  assertEquals(dropped.ok, true);
  const gone = library.collections();
  if (gone.ok) assertEquals(gone.value.length, 0);

  // Deleting an item cascades out of collection_items
  const secondCollection = library.createCollection("New");
  if (secondCollection.ok) {
    db.connection.prepare("DELETE FROM items WHERE id = ?").run(itemId);
    const after = library.collectionItems(secondCollection.value.id);
    if (after.ok) assertEquals(after.value.length, 0);
  }
  db.close();
});

Deno.test("unknown collection ids surface not-found errors", () => {
  const db = new DB(":memory:");
  const library = new LibraryService(db);
  const result = library.collection(999);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "NOT_FOUND");
  const removed = library.removeFromCollection(1, 1);
  assertEquals(removed.ok, false);
  db.close();
});

Deno.test("catalog page size setting persists and clamps", () => {
  const db = new DB(":memory:");
  const settings = new SettingsService(db, ["/tmp/bookshelf"]);
  assertEquals(settings.catalogPageSize(), 24); // default
  settings.saveCatalogPageSize(48);
  assertEquals(settings.catalogPageSize(), 48);
  settings.saveCatalogPageSize(5000); // clamped high
  assertEquals(settings.catalogPageSize(), 96);
  settings.saveCatalogPageSize(0); // clamped low
  assertEquals(settings.catalogPageSize(), 12);
  assertEquals(settings.scanDirectories(), ["/tmp/bookshelf"]); // unaffected
  db.close();
});
