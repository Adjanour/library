import { basename, extname } from "@std/path";
import { DB } from "../src/db.ts";
import {
  extractAuthors,
  extractEPUBMetadata,
  extractPDFMetadata,
  extractTitle,
  extractTitleFromFirstPage,
  extractYear,
} from "../src/scanner.ts";

type AuditRow = {
  id: number;
  type: string;
  filename: string;
  currentTitle: string;
  currentYear: number;
  titleSource: string;
  candidateTitle: string;
  embeddedAuthor: string;
  filenameAuthor: string;
  embeddedYear: number;
  filenameYear: number;
  metadataMs: number;
  firstPageMs: number;
  totalMs: number;
};

const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const typeArg = Deno.args.find((arg) => arg.startsWith("--type="))?.split("=")[1];
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? 40));
const db = new DB();
const items = db.getAllItems()
  .filter((item) => !typeArg || extname(item.filename).slice(1) === typeArg)
  .sort((a, b) => a.id - b.id)
  .slice(0, limit);

const rows: AuditRow[] = [];
for (const item of items) {
  const started = performance.now();
  const ext = extname(item.filename).toLowerCase();
  let titleSource = "filename";
  let candidateTitle = extractTitle(item.filename);
  let embeddedAuthor = "";
  let embeddedYear = 0;
  let metadataMs = 0;
  let firstPageMs = 0;

  if (ext === ".pdf") {
    const metadataStarted = performance.now();
    const metadata = await extractPDFMetadata(item.path);
    metadataMs = performance.now() - metadataStarted;
    embeddedAuthor = metadata.author;
    candidateTitle = metadata.title.trim() || candidateTitle;
    if (metadata.title.trim()) titleSource = "pdfinfo";

    if (!metadata.title.trim()) {
      const firstPageStarted = performance.now();
      const firstPageTitle = await extractTitleFromFirstPage(item.path);
      firstPageMs = performance.now() - firstPageStarted;
      if (firstPageTitle) {
        candidateTitle = firstPageTitle;
        titleSource = "pdf-first-page";
      }
    }
    embeddedYear = extractYear(metadata.subject);
  } else if (ext === ".epub") {
    const metadataStarted = performance.now();
    const metadata = await extractEPUBMetadata(item.path);
    metadataMs = performance.now() - metadataStarted;
    embeddedAuthor = metadata.author;
    embeddedYear = metadata.year;
    if (metadata.title.trim()) {
      candidateTitle = metadata.title.trim();
      titleSource = "epub-opf";
    }
  } else {
    embeddedAuthor = "";
  }

  rows.push({
    id: item.id,
    type: ext.slice(1),
    filename: basename(item.filename),
    currentTitle: item.title,
    currentYear: item.year,
    titleSource,
    candidateTitle,
    embeddedAuthor,
    filenameAuthor: extractAuthors(item.filename),
    embeddedYear,
    filenameYear: extractYear(item.filename),
    metadataMs: Math.round(metadataMs),
    firstPageMs: Math.round(firstPageMs),
    totalMs: Math.round(performance.now() - started),
  });
}

const bySource = Object.groupBy(rows, (row) => row.titleSource);
const byType = Object.groupBy(rows, (row) => row.type);
const slowest = [...rows].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10);
console.log(JSON.stringify({
  scanned: rows.length,
  byType: Object.fromEntries(Object.entries(byType).map(([key, value]) => [key, value?.length ?? 0])),
  titleSources: Object.fromEntries(Object.entries(bySource).map(([key, value]) => [key, value?.length ?? 0])),
  missingYears: rows.filter((row) => row.currentYear === 0).length,
  titleMismatches: rows.filter((row) => row.currentTitle.trim() !== row.candidateTitle.trim()).length,
  slowest: slowest.map(({ id, filename, titleSource, metadataMs, firstPageMs, totalMs }) => ({ id, filename, titleSource, metadataMs, firstPageMs, totalMs })),
  rows,
}, null, 2));
