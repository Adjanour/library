// Core types

export type BookType = "book" | "paper" | "thesis" | "ebook" | "other";

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
  size: number;
  added_at: string;
  updated_at: string;
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
}

// Search

export interface SearchQuery {
  q: string;
  type: string;
  category: string;
  tag: string;
  purpose: string;
  year: number;
  sort: string;
  order: string;
  page: number;
  limit: number;
}

export interface SearchResult {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
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

// Reading

export type ReadingStatus = "unread" | "reading" | "finished" | "abandoned";

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
}

export interface ReadingSession {
  id: number;
  item_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  pages_read: number;
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
