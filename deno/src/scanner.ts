import { basename, extname, join, normalize, relative } from "@std/path";
import { createHash } from "node:crypto";
import type {
  BookType,
  Item,
  MetadataEvidence,
  MetadataSource,
} from "./types.ts";
import type { Result } from "./result.ts";
import { AppError, Err, Ok } from "./result.ts";
import type { DB } from "./db.ts";
import { extractDocumentContent } from "./content.ts";

const SUPPORTED_EXTENSIONS: Record<string, BookType> = {
  ".pdf": "book",
  ".epub": "ebook",
  ".mobi": "ebook",
  ".djvu": "book",
};

const ARXIV_ID = /(?<!\d)\d{4}\.\d{4,}(v\d+)?/;
const DOI = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const ISBN_CANDIDATE =
  /(?:ISBN(?:-1[03])?\s*:?\s*)?((?:97[89][\s-]?)?\d[\d\s-]{8,16}[\dXx])/gi;
const YEAR_RE = /\b(?:19|20)\d{2}\b(?![.,]\d)/;
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
const INVISIBLE_FORMAT =
  `[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]`;
const METADATA_SUFFIX_NOISE = new RegExp(
  `\\s*\\(\\s*(?:for\\s+)?(?:true\\s+epub|${INVISIBLE_FORMAT}|[.\\s])*\\s*\\)\\s*$`,
  "iu",
);
const BAD_TITLE =
  /^(course\s*name|anonymous|microsoft\s+word\s*-|\.rtf$|^[\d\s]+$|^[\.\-\s]+$)/i;
const ISBN = /^[\d][\d\s-]{8,}[\dXx]$/;
const DATE_STAMP = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}([, ]+\d{1,2}:\d{2})?/;
const HAS_FILE_EXT = /\.[a-zA-Z0-9]{2,4}$/;
const HAS_REAL_WORD = /[a-zA-Z]{3,}/;
const WATERMARK =
  /^(from the library of|wow! ?ebook|converted by|downloaded by|this is a preview|scanned by|digitally signed|d0wnl0ad|www\.)/i;
const ARXIV_LINE = /arxiv\s*:\s*\d{4}\.\d+/i;
const SKIP_LINE =
  /(provided proper attribution|project gutenberg|abstract|keywords?\s*:|©|fig\.|table\s*\d+|references?\s*|https?:\/\/|all\s+rights\s+reserved|published\s+(as|in)|proceedings\s+of|introduction|page\s*\d+|doi\s*:)/i;
const AFFILIATION =
  /^\s*\d+\s+[a-z]|(university|institute|department|research\s+(scientist|fellow|assistant|engineer)|lab[\s,]|google|microsoft|amazon|ibm|meta\s|apple[,\.]|inc[\.\s]|ltd[\.\s]|corp[\.\s])/i;

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
    if (
      !((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") || c === " ")
    ) special++;
  }
  if (cleaned.length > 10 && special * 100 / cleaned.length > 20) return true;
  return false;
}

function cleanMetadata(s: string): string {
  return s
    .replaceAll(NON_PRINTABLE, "")
    .replace(new RegExp(INVISIBLE_FORMAT, "gu"), "")
    .replaceAll(WHITESPACE, " ")
    .replace(METADATA_SUFFIX_NOISE, "")
    .trim();
}

function evidence(
  field: string,
  value: string | number | undefined,
  source: MetadataSource,
  confidence: number,
): MetadataEvidence | null {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "0") return null;
  return {
    field,
    value: normalized,
    source,
    confidence,
    extractor_version: "local-v1",
  };
}

function validISBN(value: string): boolean {
  if (value.length === 10) {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const char = value[i]!;
      const digit = i === 9 && char === "X" ? 10 : Number(char);
      if (!Number.isInteger(digit)) return false;
      total += (10 - i) * digit;
    }
    return total % 11 === 0;
  }
  if (value.length === 13) {
    let total = 0;
    for (let i = 0; i < 13; i++) {
      const digit = Number(value[i]);
      if (!Number.isInteger(digit)) return false;
      total += digit * (i % 2 === 0 ? 1 : 3);
    }
    return total % 10 === 0;
  }
  return false;
}

export function extractIdentifiers(text: string): {
  doi: string;
  isbn: string;
  arxiv_id: string;
} {
  const doiMatch = text.match(DOI)?.[0] ?? "";
  const doi = doiMatch.replace(/[.,;:]+$/, "").replace(/\)+$/, (suffix) => {
    const prefix = doiMatch.slice(0, -suffix.length);
    const opens = (prefix.match(/\(/g) ?? []).length;
    const closes = (prefix.match(/\)/g) ?? []).length;
    return opens > closes ? suffix.slice(0, opens - closes) : "";
  });
  let isbn = "";
  for (const match of text.matchAll(ISBN_CANDIDATE)) {
    const candidate = (match[1] ?? "").replace(/[\s-]/g, "").toUpperCase();
    if (validISBN(candidate)) {
      isbn = candidate;
      break;
    }
  }
  const arxiv_id = text.match(ARXIV_ID)?.[0] ?? "";
  return { doi, isbn, arxiv_id };
}

export async function calculateContentHash(path: string): Promise<string> {
  const file = await Deno.open(path, { read: true });
  const hash = createHash("sha256");
  const buffer = new Uint8Array(1024 * 1024);
  try {
    while (true) {
      const read = await file.read(buffer);
      if (read === null) break;
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest("hex");
  } finally {
    file.close();
  }
}

function looksLikeLegal(s: string): boolean {
  const lower = s.toLowerCase();
  return [
    "provided proper attribution",
    "project gutenberg",
    "all rights reserved",
    "permission to reproduce",
    "scholarly works",
    "journalistic or scholarly",
    "reproduce the tables",
    "terms of service",
    "license",
    "copyright",
  ]
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
  const result = words.map((w) =>
    w.length > 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w
  ).join(" ");
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
  const arxiv = ARXIV_ID.exec(filename);
  if (arxiv) {
    const year = 2000 + parseInt(arxiv[0].slice(0, 2));
    if (year >= 2007 && year <= 2030) return year;
  }
  const matches = filename.replace(ARXIV_ID, "").match(YEAR_RE);
  if (matches) {
    const year = parseInt(matches[0]);
    if (year >= 1900 && year <= 2030) return year;
  }
  return 0;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#x60;", "`")
    .replaceAll("&nbsp;", " ");
}

function firstXMLField(xml: string, field: string): string {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${field}[^>]*>(.*?)</(?:[a-zA-Z]+:)?${field}>`,
    "is",
  );
  const m = xml.match(re);
  return m?.[1]?.trim() ? decodeHtmlEntities(m[1].trim()) : "";
}

function allXMLFields(xml: string, field: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${field}[^>]*>(.*?)</(?:[a-zA-Z]+:)?${field}>`,
    "gis",
  );
  return [...xml.matchAll(re)]
    .map((m) => decodeHtmlEntities(m[1]!.trim()))
    .filter(Boolean);
}

function guessType(path: string, filename: string): BookType {
  if (path.includes("/papers/") || path.includes("\\papers\\")) return "paper";
  if (ARXIV_ID.test(filename)) return "paper";
  return "book";
}

export function extractTitleFromFirstPageText(text: string): string {
  const lines = text.split("\n");
  let arxivIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ARXIV_LINE.test(lines[i]!)) {
      arxivIdx = i;
      break;
    }
  }

  let startIdx = 0;
  if (arxivIdx >= 0) {
    for (let i = arxivIdx - 1; i >= 0; i--) {
      const s = lines[i]!.trim();
      if (!s) continue;
      if (
        looksLikeLegal(s) || looksLikeAffiliation(s) ||
        s.toLowerCase().includes("arxiv")
      ) continue;
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
    // A continuation line such as "& Engineering" is not a title. Requiring
    // an uppercase letter or digit also avoids accepting sentence fragments.
    if (!/^[A-Z0-9]/.test(trimmed)) continue;
    if (hasAuthorMarker(trimmed)) continue;
    if (trimmed.length < 10 || trimmed.length > 300) continue;
    return trimmed.replace(/[.,;:]+$/, "");
  }

  return "";
}

async function runCommand(cmd: string, args: string[]): Promise<string> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "null",
  });
  const output = await command.output();
  return new TextDecoder().decode(output.stdout);
}

export async function extractPDFMetadata(
  path: string,
): Promise<{
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creationDate: string;
}> {
  try {
    const info = await runCommand("pdfinfo", [path]);
    let title = "", author = "", subject = "", keywords = "", creationDate = "";
    for (const line of info.split("\n")) {
      const l = line.replace(/\r$/, "");
      if (l.startsWith("Title:")) title = l.slice(6).trim();
      else if (l.startsWith("Author:")) author = l.slice(7).trim();
      else if (l.startsWith("Subject:")) subject = l.slice(8).trim();
      else if (l.startsWith("Keywords:")) keywords = l.slice(9).trim();
      else if (l.startsWith("CreationDate:")) creationDate = l.slice(13).trim();
    }
    return { title, author, subject, keywords, creationDate };
  } catch {
    return {
      title: "",
      author: "",
      subject: "",
      keywords: "",
      creationDate: "",
    };
  }
}

export async function extractEPUBMetadata(
  path: string,
): Promise<
  {
    title: string;
    author: string;
    description: string;
    year: number;
    date: string;
    publisher: string;
    language: string;
    doi: string;
    isbn: string;
  }
> {
  const containerCmd = new Deno.Command("unzip", {
    args: ["-p", path, "META-INF/container.xml"],
    stdout: "piped",
    stderr: "piped",
  });
  const container = await containerCmd.output();
  if (container.code !== 0) {
    return {
      title: "",
      author: "",
      description: "",
      year: 0,
      date: "",
      publisher: "",
      language: "",
      doi: "",
      isbn: "",
    };
  }
  const containerXml = new TextDecoder().decode(container.stdout);

  const opfPathRe = /full-path="([^"]+)"/;
  const m = opfPathRe.exec(containerXml);
  if (!m?.[1]) {
    return {
      title: "",
      author: "",
      description: "",
      year: 0,
      date: "",
      publisher: "",
      language: "",
      doi: "",
      isbn: "",
    };
  }

  const opfCmd = new Deno.Command("unzip", {
    args: ["-p", path, m[1]],
    stdout: "piped",
    stderr: "piped",
  });
  const opf = await opfCmd.output();
  if (opf.code !== 0) {
    return {
      title: "",
      author: "",
      description: "",
      year: 0,
      date: "",
      publisher: "",
      language: "",
      doi: "",
      isbn: "",
    };
  }
  const opfXml = new TextDecoder().decode(opf.stdout);

  const title = firstXMLField(opfXml, "title");
  const author = allXMLFields(opfXml, "creator").join(", ");
  const description = firstXMLField(opfXml, "description");
  const date = firstXMLField(opfXml, "date");
  const publisher = firstXMLField(opfXml, "publisher");
  const language = firstXMLField(opfXml, "language");
  const identifiers = extractIdentifiers(
    allXMLFields(opfXml, "identifier").join("\n"),
  );
  let year = 0;
  if (date) {
    const ym = YEAR_RE.exec(date);
    if (ym) {
      const y = parseInt(ym[0]);
      if (y >= 1900 && y <= 2030) year = y;
    }
  }
  return {
    title,
    author,
    description,
    year,
    date,
    publisher,
    language,
    doi: identifiers.doi,
    isbn: identifiers.isbn,
  };
}

export async function extractTitleFromFirstPage(path: string): Promise<string> {
  try {
    const text = await runCommand("pdftotext", ["-l", "1", path, "-"]);
    return extractTitleFromFirstPageText(text);
  } catch {
    return "";
  }
}

export async function extractTextFromFirstPages(
  path: string,
  pages = 3,
): Promise<string> {
  try {
    return await runCommand("pdftotext", [
      "-f",
      "1",
      "-l",
      String(pages),
      path,
      "-",
    ]);
  } catch {
    return "";
  }
}

export async function extractPDF(
  path: string,
  filename: string,
): Promise<Partial<Item>> {
  const info = Deno.statSync(path);
  const item: Partial<Item> = {
    path,
    filename,
    type: guessType(path, filename),
    size: info.size,
  };

  const embedded = await extractPDFMetadata(path);
  let { title, author, subject } = embedded;
  const firstPages = await extractTextFromFirstPages(path);
  const identifiers = extractIdentifiers(
    [title, author, subject, embedded.keywords, firstPages, filename].join(
      "\n",
    ),
  );
  const metadataEvidence: MetadataEvidence[] = [];
  title = cleanMetadata(title);
  let titleSource: Item["title_source"] = "metadata";
  let detailedTitleSource: MetadataSource = "pdf_embedded";
  let titleConfidence = 0.95;
  if (isBadMetadata(title)) {
    title = cleanMetadata(extractTitleFromFirstPageText(firstPages));
    titleSource = "first_page";
    detailedTitleSource = "pdf_first_pages";
    titleConfidence = 0.75;
  }
  if (isBadMetadata(title)) {
    title = extractTitle(filename);
    titleSource = "filename";
    detailedTitleSource = "filename";
    titleConfidence = 0.45;
  }
  if (isBadMetadata(title)) {
    title = titleCaseFilename(filename);
    titleSource = "filename";
    detailedTitleSource = "filename";
    titleConfidence = 0.25;
  }
  item.title = title;
  item.title_source = titleSource;
  const titleEvidence = evidence(
    "title",
    title,
    detailedTitleSource,
    titleConfidence,
  );
  if (titleEvidence) metadataEvidence.push(titleEvidence);

  author = cleanMetadata(author);
  if (author && !isBadMetadata(author)) {
    item.authors = author;
    const authorEvidence = evidence("authors", author, "pdf_embedded", 0.9);
    if (authorEvidence) metadataEvidence.push(authorEvidence);
  } else {
    item.authors = extractAuthors(filename);
    const authorEvidence = evidence("authors", item.authors, "filename", 0.4);
    if (authorEvidence) metadataEvidence.push(authorEvidence);
  }
  if (subject) {
    item.description = cleanMetadata(subject);
    const descriptionEvidence = evidence(
      "description",
      item.description,
      "pdf_embedded",
      0.7,
    );
    if (descriptionEvidence) metadataEvidence.push(descriptionEvidence);
  }
  item.year = extractYear(embedded.creationDate) || extractYear(filename);
  const yearEvidence = evidence(
    "year",
    item.year,
    extractYear(embedded.creationDate) ? "pdf_embedded" : "filename",
    extractYear(embedded.creationDate) ? 0.55 : 0.4,
  );
  if (yearEvidence) metadataEvidence.push(yearEvidence);
  item.doi = identifiers.doi;
  item.isbn = identifiers.isbn;
  item.arxiv_id = identifiers.arxiv_id;
  for (const field of ["doi", "isbn", "arxiv_id"] as const) {
    const identifierEvidence = evidence(
      field,
      item[field],
      firstPages.includes(item[field] ?? "\0") ? "pdf_first_pages" : "filename",
      field === "arxiv_id" && filename.includes(item[field] ?? "\0")
        ? 0.98
        : 0.92,
    );
    if (identifierEvidence) metadataEvidence.push(identifierEvidence);
  }
  item.metadata_evidence = metadataEvidence;

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
  {
    patterns: ["interview", "leetcode", "dsa", "coding interview"],
    category: "interview-prep",
  },
  {
    patterns: ["system design", "architecture", "distributed system"],
    category: "system-design",
  },
  {
    patterns: [
      "machine learning",
      "deep learning",
      "neural",
      "artificial intelligence",
      "ai",
      "llm",
      "large language model",
      "transformer",
      "gpt",
      "natural language processing",
      "nlp",
      "computer vision",
    ],
    category: "machine-learning",
  },
  {
    patterns: ["compiler", "interpreters", "programming language", "parser"],
    category: "compilers",
  },
  { patterns: ["operating system", "linux kernel", "os"], category: "systems" },
  { patterns: ["network", "tcp", "http", "protocol"], category: "networking" },
  {
    patterns: ["database", "sql", "postgresql", "nosql", "redis", "mongodb"],
    category: "databases",
  },
  { patterns: ["python"], category: "python" },
  {
    patterns: [
      "javascript",
      "react",
      "vue",
      "typescript",
      "node",
      "web",
      "css",
      "html",
    ],
    category: "web-dev",
  },
  { patterns: ["golang", "go", "goroutine"], category: "go" },
  {
    patterns: [
      "docker",
      "kubernetes",
      "devops",
      "ci cd",
      "terraform",
      "ansible",
    ],
    category: "devops",
  },
  { patterns: ["algorithm", "data structure"], category: "algorithms" },
  {
    patterns: [
      "security",
      "crypto",
      "cryptography",
      "cybersecurity",
      "vulnerability",
      "penetration",
    ],
    category: "security",
  },
  {
    patterns: [
      "design pattern",
      "software design",
      "clean code",
      "refactoring",
    ],
    category: "software-design",
  },
  {
    patterns: ["agile", "project management", "scrum"],
    category: "management",
  },
  {
    patterns: [
      "math",
      "numerical",
      "geometry",
      "statistics",
      "linear algebra",
      "calculus",
    ],
    category: "mathematics",
  },
  {
    patterns: ["physics", "quantum", "mechanics", "thermodynamics"],
    category: "physics",
  },
  {
    patterns: ["biology", "genetics", "neuroscience", "evolution"],
    category: "biology",
  },
  {
    patterns: ["philosophy", "african", "nkrumah", "pan african"],
    category: "philosophy",
  },
  {
    patterns: ["history", "historical", "ancient", "medieval"],
    category: "history",
  },
  {
    patterns: ["economics", "finance", "investing", "stock", "trading"],
    category: "economics",
  },
  { patterns: ["stoic", "ethics"], category: "philosophy" },
  {
    patterns: ["self help", "productivity", "habit", "mindfulness"],
    category: "self-help",
  },
  {
    patterns: ["fiction", "novel", "science fiction", "fantasy"],
    category: "fiction",
  },
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

export function guessPurpose(
  title: string,
  category: string,
  tags: string,
  description: string,
  filename: string,
): string {
  const combined =
    (title + " " + category + " " + tags + " " + description + " " + filename)
      .toLowerCase();

  if (combined.includes("interview") || combined.includes("leetcode")) {
    return "interview-prep";
  }
  if (
    combined.includes("reference") || combined.includes("handbook") ||
    combined.includes("documentation")
  ) return "reference";
  if (
    category === "research" || combined.includes("survey") ||
    ARXIV_ID.test(filename)
  ) return "research";
  if (combined.includes("thesis")) return "academic";
  if (
    combined.includes("textbook") || combined.includes("introduction") ||
    combined.includes("course")
  ) return "learning";
  if (
    combined.includes("cookbook") || combined.includes("practical") ||
    combined.includes("hands-on")
  ) return "practice";
  if (
    combined.includes("self help") || combined.includes("productivity") ||
    combined.includes("habit")
  ) return "self-improvement";
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
    const successfulRoots = new Set<string>();
    async function scanDir(dir: string, depth = 0): Promise<boolean> {
      if (depth > 10) return true;
      let healthy = true;
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory) {
            if (!await scanDir(fullPath, depth + 1)) healthy = false;
          } else if (entry.isFile || entry.isSymlink) {
            // For symlinks, stat to resolve target
            try {
              const stat = await Deno.stat(fullPath);
              if (stat.isDirectory) {
                if (!await scanDir(fullPath, depth + 1)) healthy = false;
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
        // A partially unreadable root is not safe for missing-file decisions.
        healthy = false;
      }
      return healthy;
    }
    for (const dir of dirs) {
      if (await scanDir(dir)) successfulRoots.add(normalize(dir));
    }

    const isUnderSuccessfulRoot = (path: string): boolean => {
      const normalized = normalize(path);
      for (const root of successfulRoots) {
        const rel = relative(root, normalized);
        if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) {
          return true;
        }
      }
      return false;
    };

    // Check each DB item
    const dbItems = db.getAllItems();
    let removed = 0;
    let moved = 0;
    const claimed = new Set<string>(); // disk paths already matched
    const hashCache = new Map<string, string>();
    const hashFor = async (path: string): Promise<string> => {
      const cached = hashCache.get(path);
      if (cached) return cached;
      const hash = await calculateContentHash(path);
      hashCache.set(path, hash);
      return hash;
    };

    // First pass: check all paths exist
    for (const item of dbItems) {
      if (diskPaths.has(item.path)) {
        claimed.add(item.path);
      }
    }

    // Second pass: handle missing files
    for (const item of dbItems) {
      if (item.ignored || !isUnderSuccessfulRoot(item.path)) continue;
      if (claimed.has(item.path)) continue;

      // Try to find by filename only (first unclaimed match)
      const filename = basename(item.path);
      const candidates = diskByName.get(filename) ?? [];
      let match = candidates.find((p) => !claimed.has(p));

      // A content hash survives both renames and moves. Size is used as a
      // cheap pre-filter so recovery does not hash the entire library.
      if (!match && item.content_hash) {
        for (const candidate of diskPaths) {
          if (claimed.has(candidate)) continue;
          try {
            const stat = await Deno.stat(candidate);
            if (stat.size !== item.size) continue;
            if (await hashFor(candidate) === item.content_hash) {
              match = candidate;
              break;
            }
          } catch {
            // The file may disappear during a scan; leave it for reconciliation.
          }
        }
      }

      if (match) {
        db.restorePath(item.id, match);
        claimed.add(match);
        moved++;
      } else {
        db.markMissing(item.id);
        removed++;
      }
    }

    // Add new files not already in DB
    const existingPaths = new Set(db.getAllPaths());
    const needsMetadataBackfill = new Set(
      dbItems.filter((item) => !item.content_hash).map((item) => item.path),
    );
    const files: string[] = [];
    for (const fullPath of diskPaths) {
      if (
        force || !existingPaths.has(fullPath) ||
        needsMetadataBackfill.has(fullPath)
      ) {
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
        const metadataEvidence: MetadataEvidence[] = [];
        item.title = epub.title
          ? cleanMetadata(epub.title)
          : extractTitle(filename);
        item.title_source = epub.title ? "metadata" : "filename";
        if (isBadMetadata(item.title)) {
          item.title = extractTitle(filename);
          item.title_source = "filename";
        }
        if (isBadMetadata(item.title)) {
          item.title = titleCaseFilename(filename);
          item.title_source = "filename";
        }
        item.authors = epub.author || extractAuthors(filename);
        if (epub.description) {
          item.description = cleanMetadata(epub.description);
        }
        item.year = epub.year || extractYear(filename);
        item.publisher = cleanMetadata(epub.publisher);
        item.language = cleanMetadata(epub.language);
        item.doi = epub.doi;
        item.isbn = epub.isbn;
        for (
          const [field, value, source, confidence] of [
            [
              "title",
              item.title,
              epub.title ? "epub_opf" : "filename",
              epub.title ? 0.98 : 0.45,
            ],
            [
              "authors",
              item.authors,
              epub.author ? "epub_opf" : "filename",
              epub.author ? 0.95 : 0.4,
            ],
            ["description", item.description, "epub_opf", 0.85],
            [
              "year",
              item.year,
              epub.year ? "epub_opf" : "filename",
              epub.year ? 0.9 : 0.4,
            ],
            ["publisher", item.publisher, "epub_opf", 0.9],
            ["language", item.language, "epub_opf", 0.9],
            ["doi", item.doi, "epub_opf", 0.98],
            ["isbn", item.isbn, "epub_opf", 0.98],
          ] as const
        ) {
          const candidate = evidence(field, value, source, confidence);
          if (candidate) metadataEvidence.push(candidate);
        }
        item.metadata_evidence = metadataEvidence;
      } else {
        item = parseFile(path);
        item.title = extractTitle(filename);
        item.title_source = "filename";
        item.authors = extractAuthors(filename);
        item.metadata_evidence = [
          evidence("title", item.title, "filename", 0.4),
          evidence("authors", item.authors, "filename", 0.35),
        ].filter((candidate): candidate is MetadataEvidence =>
          candidate !== null
        );
      }

      item.year = item.year || extractYear(filename);
      item.category = item.category || guessCategory(path, filename);
      item.tags = item.tags || guessTags(path, filename);
      item.purpose = item.purpose ||
        guessPurpose(
          item.title ?? "",
          item.category,
          item.tags,
          item.description ?? "",
          filename,
        );
      item.description = item.description || "";
      item.content_hash = await calculateContentHash(path);

      const upsertResult = db.upsertItem(item as Item);
      if (upsertResult.ok) indexed++;
    }

    // Keep the document-content index in sync with the catalog. Content is
    // indexed separately from metadata because extraction can invoke external
    // tools and is considerably more expensive than the catalog scan.
    for (const path of diskPaths) {
      const itemResult = db.getItemByPath(path);
      if (!itemResult.ok) continue;
      const item = itemResult.value;
      const state = db.getContentIndexState(item.id);
      const complete = state && state.content_hash === item.content_hash &&
        ["indexed", "truncated", "needs_ocr", "unavailable"].includes(state.status);
      if (!force && complete) continue;

      const extracted = await extractDocumentContent(item);
      db.replaceDocumentContent(
        item.id,
        item.content_hash ?? "",
        extracted.status,
        extracted.chunks,
        extracted.error,
      );
    }

    return Ok({ indexed, removed, moved });
  } catch (e) {
    return Err(AppError("IO", `scan failed: ${e}`, e));
  }
}
