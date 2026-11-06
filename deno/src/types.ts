// Core types

export type BookType = "book" | "paper" | "thesis" | "ebook" | "other";

export type MetadataSource =
  | "pdf_embedded"
  | "pdf_first_pages"
  | "epub_opf"
  | "filename"
  | "ocr"
  | "grobid"
  | "crossref"
  | "open_library"
  | "manual";

export interface MetadataEvidence {
  field: string;
  value: string;
  source: MetadataSource;
  confidence: number;
  extractor_version: string;
}

export interface Item {
  id: number;
  title: string;
  authors: string;
  year: number;
  path: string;
  filename: string;
  type: BookType;
  category: string;
  tags: string;
  purpose: string;
  description: string;
  publisher?: string;
  language?: string;
  doi?: string;
  isbn?: string;
  arxiv_id?: string;
  content_hash?: string;
  size: number;
  added_at: string;
  updated_at: string;
  title_source?: "metadata" | "first_page" | "filename" | "manual";
  locked_fields?: string;
  missing_at?: string | null;
  ignored?: number;
  metadata_evidence?: MetadataEvidence[];
}

export interface ItemUpdate {
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  path?: string | null;
  category?: string | null;
  tags?: string | null;
  purpose?: string | null;
  description?: string | null;
  publisher?: string | null;
  language?: string | null;
  doi?: string | null;
  isbn?: string | null;
  arxiv_id?: string | null;
}

export type MetadataSuggestionStatus = "pending" | "applied" | "rejected";

export interface MetadataSuggestion {
  id: number;
  item_id: number;
  field: keyof Pick<Item, "title" | "authors" | "year" | "publisher" | "language" | "doi" | "isbn" | "description">;
  value: string;
  source: Extract<MetadataSource, "crossref" | "open_library" | "grobid">;
  confidence: number;
  details_json: string;
  status: MetadataSuggestionStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface PendingMetadataSuggestion extends MetadataSuggestion {
  item: Item;
}

// Search

export interface SearchQuery {
  q: string;
  type: string;
  types?: string[];
  category: string;
  categories?: string[];
  tag: string;
  tags?: string[];
  purpose: string;
  purposes?: string[];
  status?: string;
  year: number;
  sort: string;
  order: string;
  page: number;
  limit: number;
  cursor?: string;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface SearchResult {
  items: SearchItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor?: string | null;
  facets?: SearchFacets;
}

export interface SearchFacets {
  type: TagCount[];
  category: TagCount[];
  purpose: TagCount[];
  tag: TagCount[];
}

export interface SearchItem extends Item {
  progress: ReadingProgress | null;
  match_snippet?: string | null;
}

export type ContentIndexStatus =
  | "indexed"
  | "needs_ocr"
  | "unavailable"
  | "failed"
  | "truncated";

export interface DocumentChunk {
  location: string;
  heading: string;
  content: string;
}

export interface ContentIndexState {
  item_id: number;
  content_hash: string;
  status: ContentIndexStatus;
  chunk_count: number;
  indexed_at: string;
  error: string;
}

export interface ContentIndexStats {
  indexed: number;
  truncated: number;
  needs_ocr: number;
  failed: number;
  unavailable: number;
  pending: number;
  total: number;
}

export interface ContentSearchResult {
  item: SearchItem;
  location: string;
  heading: string;
  snippet: string;
}

// Statistics

export interface Stats {
  total_items: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  by_year: Record<string, number>;
  recent_added: Item[];
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface AppSettings {
  scan_directories: string[];
}

// Reading

export type ReadingStatus =
  | "unread"
  | "queued"
  | "reading"
  | "finished"
  | "dropped"
  | "abandoned";

export interface ReadingProgress {
  item_id: number;
  status: ReadingStatus;
  progress_percent: number;
  current_page: number;
  total_pages: number;
  started_at: string | null;
  finished_at: string | null;
  last_read_at: string | null;
  updated_at: string;
  location?: string | null;
}

export interface ReadingProgressUpdate {
  progress_percent: number;
  current_page: number;
  total_pages: number;
  location?: string | null;
}

export interface Bookmark {
  id: number;
  item_id: number;
  location: string;
  label: string;
  percent: number;
  created_at: string;
}

export interface ReadingSession {
  id: number;
  item_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  pages_read: number;
  last_activity_at: string | null;
}

export interface ReadingQueueItem {
  id: number;
  item_id: number | null;
  focusd_book_number: number | null;
  title: string;
  author: string;
  priority: number;
  added_at: string;
  file_path?: string | null;
  filename?: string | null;
  file_type?: string | null;
}

export interface ReadingDashboard {
  currently_reading: ReadingStatusItem[];
  queue: ReadingQueueItem[];
  total_read_books: number;
  total_reading_minutes: number;
  today_reading_minutes: number;
  week_reading_minutes: number;
}

export interface ReadingStatusItem {
  item: Item;
  progress: ReadingProgress;
  today_minutes: number;
  total_minutes: number;
}

export interface Annotation {
  id: number;
  item_id: number;
  cfi_range: string;
  text: string;
  note: string;
  created_at: string;
}

// Readest sync

export interface ReadestSyncStatus {
  enabled: boolean;
  last_sync_at: string | null;
  total_books: number;
  matched_books: number;
  unmatched_books: number;
  currently_reading: number;
}

export interface ReadestSyncResult {
  success: boolean;
  message: string;
  synced_at: string;
  total_books: number;
  matched_books: number;
  unmatched_books: number;
  updated_progress: number;
  books: ReadestSyncedBook[];
}

export interface ReadestSyncedBook {
  hash: string;
  title: string;
  library_item_id: number;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  match_strategy: string;
  confidence: number;
}
