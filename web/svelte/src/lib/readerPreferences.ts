export const READER_PREFERENCES_KEY = "library:reader-preferences";
export const LEGACY_EPUB_PREFERENCES_KEY = "library:epub-settings";

export const FONT_SIZES: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const LINE_HEIGHTS: readonly number[] = [1.35, 1.5, 1.65, 1.8, 2];
export const CONTENT_WIDTHS: readonly number[] = [560, 640, 720, 840, 960];
export const PDF_ZOOMS: readonly number[] = [80, 100, 110, 120, 135, 150, 175, 200];

export type ReaderPreferences = {
  fontSize: number;
  fontFamily: "default" | "serif" | "sans" | "mono";
  lineHeight: number;
  contentWidth: number;
  theme: "light" | "sepia" | "dark" | "black";
  spread: "none" | "both";
  flow: "paginated" | "scrolled";
  pdfZoom: number;
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 100,
  fontFamily: "default",
  lineHeight: 1.65,
  contentWidth: 720,
  theme: "light",
  spread: "none",
  flow: "paginated",
  pdfZoom: 120,
};

function allowed(value: number, values: readonly number[], fallback: number) {
  return values.includes(value) ? value : fallback;
}

export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const raw = value && typeof value === "object" ? value as Partial<ReaderPreferences> : {};
  const fontFamilies = ["default", "serif", "sans", "mono"];
  const themes = ["light", "sepia", "dark", "black"];
  return {
    fontSize: allowed(Number(raw.fontSize), FONT_SIZES, DEFAULT_READER_PREFERENCES.fontSize),
    fontFamily: fontFamilies.includes(String(raw.fontFamily))
      ? raw.fontFamily as ReaderPreferences["fontFamily"]
      : DEFAULT_READER_PREFERENCES.fontFamily,
    lineHeight: allowed(Number(raw.lineHeight), LINE_HEIGHTS, DEFAULT_READER_PREFERENCES.lineHeight),
    contentWidth: allowed(Number(raw.contentWidth), CONTENT_WIDTHS, DEFAULT_READER_PREFERENCES.contentWidth),
    theme: themes.includes(String(raw.theme))
      ? raw.theme as ReaderPreferences["theme"]
      : DEFAULT_READER_PREFERENCES.theme,
    spread: raw.spread === "both" ? "both" : "none",
    flow: raw.flow === "scrolled" ? "scrolled" : "paginated",
    pdfZoom: allowed(Number(raw.pdfZoom), PDF_ZOOMS, DEFAULT_READER_PREFERENCES.pdfZoom),
  };
}

export function loadReaderPreferences(storage: Pick<Storage, "getItem"> = localStorage): ReaderPreferences {
  try {
    const saved = storage.getItem(READER_PREFERENCES_KEY) || storage.getItem(LEGACY_EPUB_PREFERENCES_KEY);
    return normalizeReaderPreferences(saved ? JSON.parse(saved) : undefined);
  } catch {
    return { ...DEFAULT_READER_PREFERENCES };
  }
}

export function saveReaderPreferences(
  preferences: ReaderPreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(READER_PREFERENCES_KEY, JSON.stringify(normalizeReaderPreferences(preferences)));
}
