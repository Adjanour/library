import { extname } from "@std/path";
import type { Item, MetadataSuggestion } from "../types.ts";

export type MetadataCandidate = Omit<
  MetadataSuggestion,
  "id" | "item_id" | "status" | "created_at" | "resolved_at"
>;

function decode(value: string): string {
  return value.replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replace(/\s+/g, " ").trim();
}

function first(xml: string, expression: RegExp): string {
  return decode(xml.match(expression)?.[1] ?? "").slice(0, 4_000);
}

function candidate(
  field: MetadataCandidate["field"],
  value: string,
  confidence: number,
): MetadataCandidate | null {
  if (!value) return null;
  return {
    field,
    value,
    source: "grobid",
    confidence,
    details_json: JSON.stringify({ provider: "GROBID", matched_by: "pdf_header" }),
  };
}

/** Parses only the header fields we present as reviewable suggestions. */
export function parseGrobidTei(xml: string): MetadataCandidate[] {
  const titleBlock = xml.match(/<titleStmt\b[^>]*>([\s\S]*?)<\/titleStmt>/i)?.[1] ?? xml;
  const title = first(titleBlock, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const authorBlocks = [...xml.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)];
  const authors = authorBlocks.map((match) => {
    const forename = first(match[1]!, /<forename\b[^>]*>([\s\S]*?)<\/forename>/i);
    const surname = first(match[1]!, /<surname\b[^>]*>([\s\S]*?)<\/surname>/i);
    return [forename, surname].filter(Boolean).join(" ");
  }).filter(Boolean).join(", ");
  const doi = first(xml, /<idno\b[^>]*type=["']DOI["'][^>]*>([\s\S]*?)<\/idno>/i)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const abstract = first(xml, /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i);
  const date = first(xml, /<date\b[^>]*(?:type=["']published["'])?[^>]*when=["'](\d{4})[^"']*["'][^>]*>/i) ||
    first(xml, /<date\b[^>]*>(\d{4})[^<]*<\/date>/i);
  return [
    candidate("title", title, 0.92),
    candidate("authors", authors, 0.9),
    candidate("doi", doi, 0.96),
    candidate("description", abstract, 0.82),
    candidate("year", /^\d{4}$/.test(date) ? date : "", 0.8),
  ].filter((value): value is MetadataCandidate => Boolean(value));
}

export class GrobidService {
  constructor(private readonly baseUrl = Deno.env.get("GROBID_URL")?.trim() ?? "") {}

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async extract(item: Item): Promise<MetadataCandidate[]> {
    if (!this.configured) throw new Error("GROBID_URL is not configured");
    if (extname(item.path).toLowerCase() !== ".pdf") {
      throw new Error("GROBID header extraction supports PDF files only");
    }
    const endpoint = this.baseUrl.replace(/\/$/, "").endsWith("/api/processHeaderDocument")
      ? this.baseUrl.replace(/\/$/, "")
      : `${this.baseUrl.replace(/\/$/, "")}/api/processHeaderDocument`;
    const bytes = await Deno.readFile(item.path);
    const data = new FormData();
    data.set("input", new Blob([bytes], { type: "application/pdf" }), item.filename);
    const response = await fetch(endpoint, { method: "POST", body: data });
    if (!response.ok) throw new Error(`GROBID returned ${response.status}`);
    return parseGrobidTei(await response.text());
  }
}
