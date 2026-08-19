import { extname, basename } from "@std/path";
import type { BookType, Item } from "./types.ts";
import type { Result } from "./result.ts";
import { Ok, Err, AppError } from "./result.ts";
import type { DB } from "./db.ts";

const SUPPORTED_EXTENSIONS: Record<string, BookType> = {
  ".pdf": "book",
  ".epub": "ebook",
  ".mobi": "ebook",
  ".djvu": "book",
};

const ARXIV_ID = /\d{4}\.\d{4,}(v\d+)?/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const AUTHOR_PARENS = /\(([^)]+)\)/g;
const ZLIBRARY_SK = /\s*\(z-library\.sk.*?\)\s*/g;
const ZLIB_ORG = /\s*\(z-lib\.org.*?\)\s*/g;
const ONELIB_SK = /\s*\(1lib\.sk.*?\)\s*/g;
const ZLIBRARY_CAP = /\s*\(Z-Library\)\s*/g;
const TRAILING_NUMS = /\s*\(\d+\)\s*$/g;
const PARENS = /\([^)]*\)/g;
const CLEAN_TITLE = /[_\-,.]+/g;
const WHITESPACE = /\s+/g;
const NON_PRINTABLE = /[\x00-\x08\x0e-\x1f\x7f-\x9f]/g;
const BAD_TITLE = /^(course\s*name|anonymous|microsoft\s+word\s*-|\.rtf$|^[\d\s]+$|^[\.\-\s]+$)/i;
const ISBN = /^[\d][\d\s-]{8,}[\dXx]$/;
const DATE_STAMP = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}([, ]+\d{1,2}:\d{2})?/;
const HAS_FILE_EXT = /\.[a-zA-Z0-9]{2,4}$/;
const HAS_REAL_WORD = /[a-zA-Z]{3,}/;
const WATERMARK = /^(from the library of|wow! ?ebook|converted by|downloaded by|this is a preview|scanned by|digitally signed|d0wnl0ad|www\.)/i;
const ARXIV_LINE = /arxiv\s*:\s*\d{4}\.\d+/i;
const SKIP_LINE = /(provided proper attribution|project gutenberg|abstract|keywords?\s*:|©|fig\.|table\s*\d+|references?\s*|https?:\/\/|all\s+rights\s+reserved|published\s+(as|in)|proceedings\s+of|introduction|page\s*\d+|doi\s*:)/i;
const AFFILIATION = /^\s*\d+\s+[a-z]|(university|institute|department|research\s+(scientist|fellow|assistant|engineer)|lab[\s,]|google|microsoft|amazon|ibm|meta\s|apple[,\.]|inc[\.\s]|ltd[\.\s]|corp[\.\s])/i;

function isBadMetadata(s: string): boolean {
  if (!s || s === "-" || s.length < 5) return true;
  const cleaned = s.replaceAll(NON_PRINTABLE, "");
  if (cleaned.length < s.length / 2) return true;
  const stripped = cleaned.replaceAll(PARENS, "").trim();
  if (!stripped) return true;
  if (BAD_TITLE.test(stripped) || BAD_TITLE.test(s)) return true;
  if (s.toLowerCase().includes("anonymous")) return true;
  if (ISBN.test(stripped)) return true;
  if (DATE_STAMP.test(stripped)) return true;
  if (HAS_FILE_EXT.test(s)) return true;
  if (WATERMARK.test(s)) return true;
  if (!HAS_REAL_WORD.test(cleaned)) return true;
  let special = 0;
  for (const c of cleaned) {
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === " ")) special++;
  }
  if (cleaned.length > 10 && special * 100 / cleaned.length > 20) return true;
  let lower = 0;
  for (const c of cleaned) {
    if (c >= "a" && c <= "z") lower++;
  }
  if (cleaned.length > 10 && lower === 0) return true;
  return false;
}

function cleanMetadata(s: string): string {
  return s.replaceAll(NON_PRINTABLE, "").trim();
}

function looksLikeLegal(s: string): boolean {
  const lower = s.toLowerCase();
  return ["provided proper attribution", "project gutenberg", "all rights reserved",
    "permission to reproduce", "scholarly works", "journalistic or scholarly",
    "reproduce the tables", "terms of service", "license", "copyright"]
    .some((k) => lower.includes(k));
}

function looksLikeAffiliation(s: string): boolean {
  return s.includes("@") || AFFILIATION.test(s);
}

function hasAuthorMarker(s: string): boolean {
  return /\b[a-z]+\d\b/.test(s);
}

export function extractTitle(filename: string): string {
  let title = basename(filename, extname(filename));
  title = title.replaceAll(ZLIBRARY_SK, "");
  title = title.replaceAll(ZLIB_ORG, "");
  title = title.replaceAll(ONELIB_SK, "");
  title = title.replaceAll(ZLIBRARY_CAP, "");
  title = title.replaceAll(TRAILING_NUMS, "");
  title = title.replaceAll(PARENS, "");
  title = title.replaceAll(CLEAN_TITLE, " ");
  title = title.replaceAll(WHITESPACE, " ");
  return title.trim();
}

function titleCaseFilename(filename: string): string {
  let name = basename(filename, extname(filename));
  name = name.replaceAll(/[_\-\.]/g, " ");
  const words = name.split(/\s+/);
  const result = words.map((w) => w.length > 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w).join(" ");
  return result.length < 5 ? `Untitled - ${filename}` : result;
}

export function extractAuthors(filename: string): string {
  const matches = [...filename.matchAll(AUTHOR_PARENS)];
  if (matches.length > 0) {
    const authors = matches
      .map((m) => m[1])
      .filter((c) => c && !c.includes(".") && c.length > 3);
    if (authors.length > 0) return authors.join(", ");
  }
  return "";
}

export function extractYear(filename: string): number {
  const matches = filename.match(YEAR_RE);
  if (matches) {
    const year = parseInt(matches[0]);
    if (year >= 1900 && year <= 2030) return year;
  }
  return 0;
}

function decodeHtmlEntities(s: string): string {
  return s.
          replaceAll("&amp;", "&").
          replaceAll("&lt;", "<").
          replaceAll("&gt;", ">").
          replaceAll("&quot;", '"').
          replaceAll("&apos;", "'").
          replaceAll("&#39;", "'").
          replaceAll("&#x2F;", "/").
          replaceAll("&#x60;", "`").
          replaceAll("&nbsp;", " ");
}

function firstXMLField(xml: string, field: string): string {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}[^>]*>(.*?)</(?:[a-zA-Z]+:)?${field}>`, "is");
  const m = xml.match(re);
  return m?.[1]?.trim() ? decodeHtmlEntities(m[1].trim()) : "";
}

function allXMLFields(xml: string, field: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}[^>]*>(.*?)</(?:[a-zA-Z]+:)?${field}>`, "gis");
  return [...xml.matchAll(re)]
    .map((m) => decodeHtmlEntities(m[1]!.trim()))
    .filter(Boolean);
}

function guessType(path: string, filename: string): BookType {
  if (path.includes("/papers/") || path.includes("\\papers\\")) return "paper";
  if (ARXIV_ID.test(filename)) return "paper";
  return "book";
}

function cleanTitleFromFirstPage(text: string): string {
  const lines = text.split("\n");
  let arxivIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ARXIV_LINE.test(lines[i]!)) { arxivIdx = i; break; }
  }

  let startIdx = 0;
  if (arxivIdx >= 0) {
    for (let i = arxivIdx - 1; i >= 0; i--) {
      const s = lines[i]!.trim();
      if (!s) continue;
      if (looksLikeLegal(s) || looksLikeAffiliation(s) || s.toLowerCase().includes("arxiv")) continue;
      if (s.length < 10 || s === s.toLowerCase()) continue;
      if (isBadMetadata(s)) continue;
      if (hasAuthorMarker(s)) continue;
      return s.replace(/[.,;:]+$/, "");
    }
    startIdx = arxivIdx + 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase().includes("arxiv")) continue;
    if (isBadMetadata(trimmed)) continue;
    if (SKIP_LINE.test(trimmed)) continue;
    if (looksLikeAffiliation(trimmed)) continue;
    if (hasAuthorMarker(trimmed)) continue;
    if (trimmed.length < 10 || trimmed.length > 300) continue;
    return trimmed.replace(/[.,;:]+$/, "");
  }

  return "";
}

async function runCommand(cmd: string, args: string[]): Promise<string> {
  const command = new Deno.Command(cmd, { args, stdout: "piped", stderr: "null" });
  const output = await command.output();
  return new TextDecoder().decode(output.stdout);
}

export async function extractPDFMetadata(path: string): Promise<{ title: string; author: string; subject: string }> {
  try {
    const info = await runCommand("pdfinfo", [path]);
    let title = "", author = "", subject = "";
    for (const line of info.split("\n")) {
      const l = line.replace(/\r$/, "");
      if (l.startsWith("Title:")) title = l.slice(6).trim();
      else if (l.startsWith("Author:")) author = l.slice(7).trim();
      else if (l.startsWith("Subject:")) subject = l.slice(8).trim();
    }
    return { title, author, subject };
  } catch {
    return { title: "", author: "", subject: "" };
  }
}

export async function extractEPUBMetadata(path: string): Promise<{ title: string; author: string; description: string; year: number; date: string }> {

  const containerCmd = new Deno.Command("unzip", { args: ["-p", path, "META-INF/container.xml"], stdout: "piped", stderr: "piped" });
  const container = await containerCmd.output();
  if (container.code !== 0) {
    return { title: "", author: "", description: "", year: 0, date: "" };
  }
  const containerXml = new TextDecoder().decode(container.stdout);

  const opfPathRe = /full-path="([^"]+)"/;
  const m = opfPathRe.exec(containerXml);
  if (!m?.[1]) {
    return { title: "", author: "", description: "", year: 0, date: "" };
  }

  const opfCmd = new Deno.Command("unzip", { args: ["-p", path, m[1]], stdout: "piped", stderr: "piped" });
  const opf = await opfCmd.output();
  if (opf.code !== 0) {
    return { title: "", author: "", description: "", year: 0, date: "" };
  }
  const opfXml = new TextDecoder().decode(opf.stdout);

  const title = firstXMLField(opfXml, "title");
  const author = allXMLFields(opfXml, "creator").join(", ");
  const description = firstXMLField(opfXml, "description");
  const date = firstXMLField(opfXml, "date");
  let year = 0;
  if (date) {
    const ym = YEAR_RE.exec(date);
    if (ym) {
      const y = parseInt(ym[0]);
      if (y >= 1900 && y <= 2030) year = y;
    }
  }
  return { title, author, description, year, date };
}

export async function extractTitleFromFirstPage(path: string): Promise<string> {
  try {
    const text = await runCommand("pdftotext", ["-l", "1", path, "-"]);
    return cleanTitleFromFirstPage(text);
  } catch {
    return "";
  }
}

export async function extractPDF(path: string, filename: string): Promise<Partial<Item>> {
  const info = Deno.statSync(path);
  const item: Partial<Item> = { path, filename, type: guessType(path, filename), size: info.size };

  let { title, author, subject } = await extractPDFMetadata(path);
  title = cleanMetadata(title);
  if (isBadMetadata(title)) title = cleanMetadata(await extractTitleFromFirstPage(path));
  if (isBadMetadata(title)) title = extractTitle(filename);
  if (isBadMetadata(title)) title = titleCaseFilename(filename);
  item.title = title;

  author = cleanMetadata(author);
  if (author && !isBadMetadata(author)) {
    item.authors = author;
  } else {
    item.authors = extractAuthors(filename);
  }
  if (subject) item.description = cleanMetadata(subject);

  return item;
}

export function parseFile(path: string): Partial<Item> {
  const ext = extname(path).toLowerCase();
  const filename = basename(path);
  const info = Deno.statSync(path);

  return {
    path,
    filename,
    type: SUPPORTED_EXTENSIONS[ext] ?? "other",
    size: info.size,
  };
}

function wordBoundaryPattern(p: string): RegExp {
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`);
}

const CATEGORY_RULES: { patterns: string[]; category: string }[] = [
  { patterns: ["thesis"], category: "thesis" },
  { patterns: ["papers", "research"], category: "research" },
  { patterns: ["interview", "leetcode", "dsa", "coding interview"], category: "interview-prep" },
  { patterns: ["system design", "architecture", "distributed system"], category: "system-design" },
  { patterns: ["machine learning", "deep learning", "neural", "artificial intelligence", "ai", "llm", "large language model", "transformer", "gpt", "natural language processing", "nlp", "computer vision"], category: "machine-learning" },
  { patterns: ["compiler", "interpreters", "programming language", "parser"], category: "compilers" },
  { patterns: ["operating system", "linux kernel", "os"], category: "systems" },
  { patterns: ["network", "tcp", "http", "protocol"], category: "networking" },
  { patterns: ["database", "sql", "postgresql", "nosql", "redis", "mongodb"], category: "databases" },
  { patterns: ["python"], category: "python" },
  { patterns: ["javascript", "react", "vue", "typescript", "node", "web", "css", "html"], category: "web-dev" },
  { patterns: ["golang", "go", "goroutine"], category: "go" },
  { patterns: ["docker", "kubernetes", "devops", "ci cd", "terraform", "ansible"], category: "devops" },
  { patterns: ["algorithm", "data structure"], category: "algorithms" },
  { patterns: ["security", "crypto", "cryptography", "cybersecurity", "vulnerability", "penetration"], category: "security" },
  { patterns: ["design pattern", "software design", "clean code", "refactoring"], category: "software-design" },
  { patterns: ["agile", "project management", "scrum"], category: "management" },
  { patterns: ["math", "numerical", "geometry", "statistics", "linear algebra", "calculus"], category: "mathematics" },
  { patterns: ["physics", "quantum", "mechanics", "thermodynamics"], category: "physics" },
  { patterns: ["biology", "genetics", "neuroscience", "evolution"], category: "biology" },
  { patterns: ["philosophy", "african", "nkrumah", "pan african"], category: "philosophy" },
  { patterns: ["history", "historical", "ancient", "medieval"], category: "history" },
  { patterns: ["economics", "finance", "investing", "stock", "trading"], category: "economics" },
  { patterns: ["stoic", "ethics"], category: "philosophy" },
  { patterns: ["self help", "productivity", "habit", "mindfulness"], category: "self-help" },
  { patterns: ["fiction", "novel", "science fiction", "fantasy"], category: "fiction" },
];

export function guessCategory(path: string, filename: string): string {
  const lowerPath = path.toLowerCase();
  const lowerFilename = filename.toLowerCase();
  const normalizedPath = lowerPath.replaceAll("-", " ");
  const normalizedFilename = lowerFilename.replaceAll("-", " ");

  for (const rule of CATEGORY_RULES) {
    for (const p of rule.patterns) {
      const re = wordBoundaryPattern(p);
      if (re.test(normalizedPath) || re.test(normalizedFilename)) {
        return rule.category;
      }
    }
  }
  return "";
}

const TAG_MAP: Record<string, string> = {
  "textbook": "textbook",
  "cookbook": "cookbook",
  "guide": "guide",
  "handbook": "handbook",
  "tutorial": "tutorial",
  "interview": "interview",
  "reference": "reference",
  "beginner": "beginner",
  "advanced": "advanced",
  "practical": "practical",
  "theory": "theory",
  "case study": "case-study",
  "real-world": "real-world",
  "production": "production",
  "classic": "classic",
  "foundational": "foundational",
  "survey": "survey",
  "introduction": "introductory",
  "complete": "comprehensive",
  "modern": "modern",
};

export function guessTags(path: string, filename: string): string {
  const lower = (filename + " " + path).toLowerCase();
  const tags: string[] = [];

  for (const [keyword, tag] of Object.entries(TAG_MAP)) {
    if (lower.includes(keyword)) {
      tags.push(tag);
    }
  }

  if (lower.includes("z-library") || lower.includes("z-lib")) {
    tags.push("ebook-download");
  }

  return tags.join(",");
}

export function guessPurpose(title: string, category: string, tags: string, description: string, filename: string): string {
  const combined = (title + " " + category + " " + tags + " " + description + " " + filename).toLowerCase();

  if (combined.includes("interview") || combined.includes("leetcode")) return "interview-prep";
  if (combined.includes("reference") || combined.includes("handbook") || combined.includes("documentation")) return "reference";
  if (category === "research" || combined.includes("survey") || ARXIV_ID.test(filename)) return "research";
  if (combined.includes("thesis")) return "academic";
  if (combined.includes("textbook") || combined.includes("introduction") || combined.includes("course")) return "learning";
  if (combined.includes("cookbook") || combined.includes("practical") || combined.includes("hands-on")) return "practice";
  if (combined.includes("self help") || combined.includes("productivity") || combined.includes("habit")) return "self-improvement";
  return "reading";
}

export async function scanDirectory(
  db: DB,
  dirs: string[],
  progress?: (current: number, total: number, filename: string) => void,
  force = false,
): Promise<Result<{ indexed: number; removed: number; moved: number }>> {
  try {
    // Collect all files on disk (recursive, max depth 10)
    const diskPaths = new Set<string>(); // full paths on disk
    const diskByName = new Map<string, string[]>(); // filename → [paths]
    async function scanDir(dir: string, depth = 0) {
      if (depth > 10) return;
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = `${dir}/${entry.name}`;
          if (entry.isDirectory) {
            await scanDir(fullPath, depth + 1);
          } else if (entry.isFile || entry.isSymlink) {
            // For symlinks, stat to resolve target
            try {
              const stat = await Deno.stat(fullPath);
              if (stat.isDirectory) {
                await scanDir(fullPath, depth + 1);
                continue;
              }
            } catch {
              continue; // broken symlink
            }
            const ext = extname(entry.name).toLowerCase();
            if (ext in SUPPORTED_EXTENSIONS) {
              diskPaths.add(fullPath);
              const arr = diskByName.get(entry.name) ?? [];
              arr.push(fullPath);
              diskByName.set(entry.name, arr);
            }
          }
        }
      } catch {
        // Skip directories we can't read (permission denied, etc.)
      }
    }
    for (const dir of dirs) {
      await scanDir(dir);
    }

    // Check each DB item
    const dbItems = db.getAllItems();
    let removed = 0;
    let moved = 0;
    const claimed = new Set<string>(); // disk paths already matched

    // First pass: check all paths exist
    for (const item of dbItems) {
      if (diskPaths.has(item.path)) {
        claimed.add(item.path);
      }
    }

    // Second pass: handle missing files
    for (const item of dbItems) {
      if (claimed.has(item.path)) continue;

      // Try to find by filename only (first unclaimed match)
      const filename = basename(item.path);
      const candidates = diskByName.get(filename) ?? [];
      const match = candidates.find((p) => !claimed.has(p));

      if (match) {
        db.updatePath(item.id, match);
        claimed.add(match);
        moved++;
      } else {
        db.deleteItem(item.id);
        removed++;
      }
    }

    // Add new files not already in DB
    const existingPaths = new Set(db.getAllPaths());
    const files: string[] = [];
    for (const fullPath of diskPaths) {
      if (force || !existingPaths.has(fullPath)) {
        files.push(fullPath);
      }
    }

    let indexed = 0;
    for (let i = 0; i < files.length; i++) {
      const path = files[i]!;
      const filename = basename(path);
      progress?.(i + 1, files.length, filename);

      const ext = extname(path).toLowerCase();
      let item: Partial<Item>;

      if (ext === ".pdf") {
        item = await extractPDF(path, filename);
      } else if (ext === ".epub") {
        item = parseFile(path);
        const epub = await extractEPUBMetadata(path);
        item.title = epub.title ? cleanMetadata(epub.title) : extractTitle(filename);
        if (isBadMetadata(item.title)) item.title = extractTitle(filename);
        if (isBadMetadata(item.title)) item.title = titleCaseFilename(filename);
        item.authors = epub.author || extractAuthors(filename);
        if (epub.description) item.description = cleanMetadata(epub.description);
        item.year = epub.year || extractYear(filename);
      } else {
        item = parseFile(path);
        item.title = extractTitle(filename);
        item.authors = extractAuthors(filename);
      }

      item.year = item.year || extractYear(filename);
      item.category = item.category || guessCategory(path, filename);
      item.tags = item.tags || guessTags(path, filename);
      item.purpose = item.purpose || guessPurpose(item.title ?? "", item.category, item.tags, item.description ?? "", filename);
      item.description = item.description || "";

      const upsertResult = db.upsertItem(item as Item);
      if (upsertResult.ok) indexed++;
    }

    return Ok({ indexed, removed, moved });
  } catch (e) {
    return Err(AppError("IO", `scan failed: ${e}`, e));
  }
}
