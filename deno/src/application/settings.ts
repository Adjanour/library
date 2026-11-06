import { isAbsolute, normalize } from "@std/path";
import type { DB } from "../db.ts";
import { ReaderPreferencesSchema } from "../validate.ts";

export class SettingsService {
  constructor(private readonly db: DB, private readonly defaults: string[]) {}
  scanDirectories(): string[] {
    const raw = this.db.getSetting("scan_directories");
    if (!raw) return this.defaults;
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) && value.length > 0 ? value : this.defaults;
    } catch {
      return this.defaults;
    }
  }
  readerPreferences() {
    const raw = this.db.getSetting("reader_preferences");
    if (!raw) return undefined;
    try {
      const parsed = ReaderPreferencesSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
  /** How many items the All Library page shows per page (clamped 12–96). */
  catalogPageSize(): number {
    const raw = this.db.getSetting("catalog_page_size");
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? Math.min(96, Math.max(12, parsed)) : 24;
  }
  saveCatalogPageSize(size: number): void {
    const clamped = Math.min(96, Math.max(12, Math.round(size)));
    this.db.setSetting("catalog_page_size", String(clamped));
  }
  saveReaderPreferences(preferences: unknown) {
    const parsed = ReaderPreferencesSchema.safeParse(preferences);
    if (!parsed.success) return parsed;
    this.db.setSetting("reader_preferences", JSON.stringify(parsed.data));
    return parsed;
  }
  async saveScanDirectories(input: string[]) {
    const directories = [
      ...new Set(input.map((path) => normalize(path.trim()))),
    ];
    for (const path of directories) {
      if (!isAbsolute(path)) {
        return {
          ok: false as const,
          error: `Scan folders must be absolute paths: ${path}`,
        };
      }
      try {
        const info = await Deno.stat(path);
        if (!info.isDirectory) {
          return { ok: false as const, error: `Not a folder: ${path}` };
        }
      } catch {
        return {
          ok: false as const,
          error: `Folder does not exist or cannot be read: ${path}`,
        };
      }
    }
    this.db.setSetting("scan_directories", JSON.stringify(directories));
    return { ok: true as const, directories };
  }
}
