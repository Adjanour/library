import { assertEquals } from "@std/assert";
import { extractTitle, extractAuthors, extractYear } from "../src/scanner.ts";

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
  ];

  for (const { input, want } of cases) {
    assertEquals(extractYear(input), want, `failed for: ${input}`);
  }
});