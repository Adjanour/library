import { assertEquals } from "@std/assert";
import {
  extractTitle,
  extractAuthors,
  extractYear,
  extractTitleFromFirstPageText,
  scanDirectory,
} from "../src/scanner.ts";
import { DB } from "../src/db.ts";
import { assert } from "@std/assert";

Deno.test("extractTitle cleans filenames", () => {
  const cases = [
    { input: "The Go Programming Language.pdf", want: "The Go Programming Language" },
    { input: "book_with_underscores.pdf", want: "book with underscores" },
    { input: "test (z-library.sk).pdf", want: "test" },
    { input: "Design Patterns (Gang of Four).pdf", want: "Design Patterns" },
    { input: "Clean Code - A Handbook.pdf", want: "Clean Code A Handbook" },
    { input: "  spaced  out  .pdf", want: "spaced out" },
  ];

  for (const { input, want } of cases) {
    assertEquals(extractTitle(input), want, `failed for: ${input}`);
  }
});

Deno.test("extractAuthors reads parenthesized names", () => {
  const cases = [
    { input: "test (Author Name).pdf", want: "Author Name" },
    { input: "book (John) and (Jane).pdf", want: "John, Jane" },
    { input: "no parens.pdf", want: "" },
    { input: "short (AB).pdf", want: "" },
    { input: "has dots (A. B.).pdf", want: "" },
  ];

  for (const { input, want } of cases) {
    assertEquals(extractAuthors(input), want, `failed for: ${input}`);
  }
});

Deno.test("extractYear finds 4-digit years", () => {
  const cases = [
    { input: "book 2020.pdf", want: 2020 },
    { input: "paper 1999.pdf", want: 1999 },
    { input: "no year.pdf", want: 0 },
    { input: "invalid 1800.pdf", want: 0 },
    { input: "future 2050.pdf", want: 0 },
    { input: "1912.13318v5.pdf", want: 2019 },
    { input: "paper 2024 (preprint).pdf", want: 2024 },
    { input: "361598.361623.pdf", want: 0 },
  ];

  for (const { input, want } of cases) {
    assertEquals(extractYear(input), want, `failed for: ${input}`);
  }
});

Deno.test("first-page title extraction rejects continuation lines", () => {
  assertEquals(
    extractTitleFromFirstPageText(
      "Department of Computer Science\n& Engineering\nA Reliable Systems Paper\nJane Doe",
    ),
    "A Reliable Systems Paper",
  );
});

Deno.test("scan marks missing files without deleting reading history", async () => {
  const db = new DB(":memory:");
  const root = await Deno.makeTempDir();
  const path = `${root}/book.pdf`;
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Book", path, "book.pdf");
  db.upsertReadingProgress({
    item_id: 1,
    status: "reading",
    progress_percent: 42,
    current_page: 4,
    total_pages: 10,
    started_at: null,
    finished_at: null,
    last_read_at: null,
    updated_at: new Date().toISOString(),
  });

  const result = await scanDirectory(db, [root]);
  assert(result.ok);
  const item = db.getItem(1);
  assert(item.ok);
  if (item.ok) assertEquals(item.value.missing_at !== null, true);
  assertEquals(db.getReadingProgress(1)?.progress_percent, 42);

  db.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("scan does not mark items under an unreadable root as missing", async () => {
  const db = new DB(":memory:");
  const root = `/tmp/library-root-that-does-not-exist-${crypto.randomUUID()}`;
  db.connection.prepare(
    "INSERT INTO items (title, path, filename) VALUES (?, ?, ?)",
  ).run("Book", `${root}/book.pdf`, "book.pdf");

  const result = await scanDirectory(db, [root]);
  assert(result.ok);
  const item = db.getItem(1);
  assert(item.ok);
  if (item.ok) assertEquals(item.value.missing_at, null);
  db.close();
});
