import { assertEquals } from "@std/assert";
import {
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  normalizeReaderPreferences,
  READER_PREFERENCES_KEY,
  saveReaderPreferences,
} from "../../web/svelte/src/lib/readerPreferences.ts";

Deno.test("reader preferences reject unsupported persisted values", () => {
  assertEquals(
    normalizeReaderPreferences({
      fontSize: 999,
      fontFamily: "comic",
      lineHeight: 12,
      contentWidth: 1,
      theme: "blue",
      spread: "wide",
      flow: "sideways",
      pdfZoom: 196,
    }),
    DEFAULT_READER_PREFERENCES,
  );
});

Deno.test("reader preferences round-trip through local storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const preferences = {
    ...DEFAULT_READER_PREFERENCES,
    theme: "sepia" as const,
    flow: "scrolled" as const,
    pdfZoom: 135,
  };

  saveReaderPreferences(preferences, storage);

  assertEquals(values.has(READER_PREFERENCES_KEY), true);
  assertEquals(loadReaderPreferences(storage), preferences);
});
