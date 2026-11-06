import type { Item, MetadataSuggestion } from "../types.ts";

type Candidate = Omit<MetadataSuggestion, "id" | "item_id" | "status" | "created_at" | "resolved_at">;

function text(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function year(value: unknown): string {
  const candidate = Array.isArray(value) && Array.isArray(value[0]) ? value[0][0] : value;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed >= 1400 && parsed <= 2100 ? String(parsed) : "";
}

function dateParts(value: unknown): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)["date-parts"]
    : undefined;
}

function authors(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((author) => {
    if (!author || typeof author !== "object") return "";
    const row = author as Record<string, unknown>;
    return [text(row.given, 200), text(row.family, 200)].filter(Boolean).join(" ") || text(row.name, 300);
  }).filter(Boolean).join(", ").slice(0, 2_000);
}

function candidate(
  field: Candidate["field"], value: string, source: Candidate["source"], confidence: number,
  details: Record<string, unknown>,
): Candidate | null {
  if (!value.trim()) return null;
  return { field, value, source, confidence, details_json: JSON.stringify(details) };
}

/** Deliberately invoked only by an explicit user action in the item panel. */
export class EnrichmentService {
  async enrich(item: Item, allowTitleLookup = false): Promise<Candidate[]> {
    const results = await Promise.all([
      this.crossref(item, allowTitleLookup).catch(() => []),
      this.openLibrary(item, allowTitleLookup).catch(() => []),
    ]);
    return results.flat();
  }

  private async crossref(item: Item, allowTitleLookup: boolean): Promise<Candidate[]> {
    let url = "";
    let confidence = 0.72;
    if (item.doi) {
      url = `https://api.crossref.org/works/${encodeURIComponent(item.doi)}`;
      confidence = 0.99;
    } else if (allowTitleLookup && item.title) {
      url = `https://api.crossref.org/works?rows=1&query.bibliographic=${encodeURIComponent([item.title, item.authors].filter(Boolean).join(" "))}`;
    } else return [];
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const payload = await response.json() as { message?: Record<string, unknown> };
    const message = payload.message ?? {};
    const listed = Array.isArray(message.items) ? message.items[0] : undefined;
    const work = (listed && typeof listed === "object" ? listed : message) as Record<string, unknown>;
    const title = Array.isArray(work.title) ? text(work.title[0]) : text(work.title);
    const source = "crossref" as const;
    const details = { provider: "Crossref", matched_by: item.doi ? "doi" : "title" };
    return [
      candidate("title", title, source, confidence, details),
      candidate("authors", authors(work.author), source, confidence, details),
      candidate("year", year(dateParts(work.published) ?? dateParts(work.issued)), source, confidence, details),
      candidate("publisher", text(work.publisher), source, confidence, details),
      candidate("doi", text(work.DOI), source, confidence, details),
    ].filter((value): value is Candidate => Boolean(value));
  }

  private async openLibrary(item: Item, allowTitleLookup: boolean): Promise<Candidate[]> {
    let url = "";
    let confidence = 0.72;
    let direct = false;
    if (item.isbn) {
      url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(item.isbn)}&format=json&jscmd=data`;
      confidence = 0.99;
      direct = true;
    } else if (allowTitleLookup && item.title) {
      url = `https://openlibrary.org/search.json?limit=1&title=${encodeURIComponent(item.title)}${item.authors ? `&author=${encodeURIComponent(item.authors)}` : ""}`;
    } else return [];
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const payload = await response.json() as Record<string, unknown>;
    const book = direct
      ? Object.values(payload)[0] as Record<string, unknown> | undefined
      : (payload.docs as Record<string, unknown>[] | undefined)?.[0];
    if (!book) return [];
    const source = "open_library" as const;
    const details = { provider: "Open Library", matched_by: direct ? "isbn" : "title" };
    const openAuthors = Array.isArray(book.authors)
      ? book.authors.map((author) => text((author as Record<string, unknown>).name, 300)).filter(Boolean).join(", ")
      : Array.isArray(book.author_name) ? book.author_name.map((author) => text(author, 300)).filter(Boolean).join(", ") : "";
    const isbn = Array.isArray(book.isbn_13) ? text(book.isbn_13[0]) : item.isbn ?? "";
    return [
      candidate("title", text(book.title), source, confidence, details),
      candidate("authors", openAuthors, source, confidence, details),
      candidate("year", year(book.publish_date ?? book.first_publish_year), source, confidence, details),
      candidate("publisher", Array.isArray(book.publishers) ? text((book.publishers[0] as Record<string, unknown>).name ?? book.publishers[0]) : text(book.publisher), source, confidence, details),
      candidate("isbn", isbn, source, confidence, details),
    ].filter((value): value is Candidate => Boolean(value));
  }
}
