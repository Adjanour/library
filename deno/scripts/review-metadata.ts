import { basename, extname } from "@std/path";
import { DB } from "../src/db.ts";
import { extractEPUBMetadata, extractPDFMetadata, extractTitle, extractYear } from "../src/scanner.ts";

type Suggestion = {
  id: number;
  filename: string;
  currentTitle: string;
  suggestedTitle?: string;
  currentYear: number;
  suggestedYear?: number;
  titleSource?: string;
  yearSource?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  applied?: string[];
};

const limit = Math.max(1, Number(Deno.args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 1000));
const type = Deno.args.find((arg) => arg.startsWith("--type="))?.split("=")[1];
const apply = Deno.args.includes("--apply");
const invisible = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
const invisibleMarker = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const suffixNoise = /\s*\(\s*(?:for\s+)?(?:true\s+epub|[.\s]*)\s*\)\s*$/iu;
const arxivId = /(?<!\d)\d{4}\.\d{4,}(?:v\d+)?/u;

function normalizeTitle(value: string): string {
  return value.replace(invisible, "").replace(/\s+/g, " ").replace(suffixNoise, "").trim();
}

const db = new DB();
const items = db.getAllItems()
  .filter((item) => !type || extname(item.filename).slice(1) === type)
  .sort((a, b) => a.id - b.id)
  .slice(0, limit);
const suggestions: Suggestion[] = [];

for (const item of items) {
  const ext = extname(item.filename).toLowerCase();
  let candidateTitle = extractTitle(item.filename);
  let titleSource = "filename";
  let candidateYear = extractYear(item.filename);
  let yearSource = candidateYear ? (arxivId.test(item.filename) ? "arxiv-id" : "filename") : "";

  if (ext === ".epub") {
    const metadata = await extractEPUBMetadata(item.path);
    if (metadata.title.trim()) { candidateTitle = metadata.title.trim(); titleSource = "epub-opf"; }
    if (metadata.year) { candidateYear = metadata.year; yearSource = "epub-date"; }
  } else if (ext === ".pdf") {
    const metadata = await extractPDFMetadata(item.path);
    if (metadata.title.trim()) { candidateTitle = metadata.title.trim(); titleSource = "pdfinfo"; }
  }

  const suggestedTitle = normalizeTitle(candidateTitle);
  const titleNeedsReview = suggestedTitle !== item.title && (
    invisibleMarker.test(item.title) || suffixNoise.test(item.title) || item.title.trim() === extractTitle(item.filename).trim()
  );
  const yearNeedsReview = item.year === 0 && candidateYear > 0;
  if (!titleNeedsReview && !yearNeedsReview) continue;

  const highConfidenceTitle = titleNeedsReview && (invisibleMarker.test(item.title) || suffixNoise.test(item.title));
  const suggestion: Suggestion = {
    id: item.id,
    filename: basename(item.filename),
    currentTitle: item.title,
    ...(titleNeedsReview ? { suggestedTitle, titleSource } : {}),
    currentYear: item.year,
    ...(yearNeedsReview ? { suggestedYear: candidateYear, yearSource } : {}),
    confidence: highConfidenceTitle || yearSource === "epub-date" ? "high" : yearSource === "filename" ? "low" : "medium",
    reason: [titleNeedsReview && "metadata title contains removable noise", yearNeedsReview && `year available from ${yearSource}`].filter(Boolean).join("; "),
  };

  const updates: { title?: string; year?: number } = {};
  if (highConfidenceTitle) updates.title = suggestedTitle;
  if (yearNeedsReview && (yearSource === "arxiv-id" || yearSource === "epub-date")) {
    updates.year = candidateYear;
  }
  if (apply && Object.keys(updates).length > 0) {
    const result = db.updateItem(item.id, updates);
    if (!result.ok) throw new Error(`Could not update item ${item.id}: ${result.error.message}`);
    suggestion.applied = Object.keys(updates);
  }
  suggestions.push(suggestion);
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "review-only",
  scanned: items.length,
  suggestions: suggestions.length,
  applied: suggestions.filter((row) => row.applied?.length).length,
  rows: suggestions,
}, null, 2));
