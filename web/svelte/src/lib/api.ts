import type { ReaderPreferences } from '$lib/readerPreferences';
import { httpTransport } from '$lib/runtime/transport';
import { bootstrap as loadBootstrap, type BootstrapResponse } from '$lib/runtime/bootstrap';

const API = '';

export interface Item {
  id: number;
  title: string;
  authors: string;
  year: number;
  path: string;
  filename: string;
  type: string;
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
  match_snippet?: string | null;
  progress?: ReadingProgress | null;
}

export interface MetadataEvidence {
  field: string;
  value: string;
  source: 'pdf_embedded' | 'pdf_first_pages' | 'epub_opf' | 'filename' | 'ocr' | 'grobid' | 'crossref' | 'open_library' | 'manual';
  confidence: number;
  extractor_version: string;
}

export interface ContentIndexState {
  item_id: number;
  content_hash: string;
  status: 'indexed' | 'needs_ocr' | 'unavailable' | 'failed' | 'truncated';
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
  item: Item;
  location: string;
  heading: string;
  snippet: string;
}

export interface MetadataSuggestion {
  id: number;
  item_id: number;
  field: string;
  value: string;
  source: 'crossref' | 'open_library' | 'grobid';
  confidence: number;
  details_json: string;
  status: 'pending' | 'applied' | 'rejected';
  created_at: string;
}

export interface PendingMetadataSuggestion extends MetadataSuggestion {
  item: Item;
}

export interface ItemUpdate {
  title?: string;
  authors?: string;
  year?: number;
  category?: string;
  tags?: string;
  purpose?: string;
  description?: string;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface SearchResult {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor?: string | null;
  facets?: SearchFacets;
}

export interface SearchFacets {
  category: CategoryCount[];
  tag: TagCount[];
  purpose: TagCount[];
  type: TagCount[];
}

export interface Stats {
  total_items: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  by_year?: Record<string, number>;
  recent_added: Item[];
}

export interface AppSettings {
  scan_directories: string[];
  catalog_page_size?: number;
  platform: 'linux' | 'darwin' | 'windows';
  version: string;
  smoke_item_id?: number;
  reading_preferences?: ReaderPreferences;
  grobid_configured?: boolean;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface ReadingProgress {
  item_id: number;
  status: string;
  progress_percent: number;
  current_page: number;
  total_pages: number;
  started_at: string;
  finished_at: string;
  last_read_at: string;
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
export interface Annotation { id: number; item_id: number; cfi_range: string; text: string; note: string; created_at: string; }

export interface ReadingSession {
  id: number;
  item_id: number;
  started_at: string;
  ended_at: string;
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
  file_path?: string;
  filename?: string;
  file_type?: string;
}

export interface ReadingDashboard {
  currently_reading: { item: Item; progress: ReadingProgress }[];
  queue: ReadingQueueItem[];
  total_read_books: number;
  total_reading_minutes: number;
  today_reading_minutes: number;
  week_reading_minutes: number;
}

async function get<T>(path: string): Promise<T> {
  if (path !== '/api/bootstrap') await loadBootstrap();
  const res = await httpTransport.request(API + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  if (path !== '/api/bootstrap') await loadBootstrap();
  const res = await httpTransport.request(API + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  if (path !== '/api/bootstrap') await loadBootstrap();
  const res = await httpTransport.request(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  if (path !== '/api/bootstrap') await loadBootstrap();
  const res = await httpTransport.request(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  if (path !== '/api/bootstrap') await loadBootstrap();
  const res = await httpTransport.request(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  bootstrap: (): Promise<BootstrapResponse> => loadBootstrap(),
  search: (q: string, opts?: { type?: string | string[]; category?: string | string[]; tag?: string | string[]; purpose?: string | string[]; status?: string; sort?: string; page?: number; limit?: number; cursor?: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    for (const [key, value] of Object.entries({ type: opts?.type, category: opts?.category, tag: opts?.tag, purpose: opts?.purpose })) {
      if (Array.isArray(value)) value.filter(Boolean).forEach((entry) => params.append(key, entry));
      else if (value) params.set(key, value);
    }
    if (opts?.status) params.set('status', opts.status);
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    return get<SearchResult>('/api/search?' + params);
  },
  stats: () => get<Stats>('/api/stats'),
  contentIndexStats: () => get<ContentIndexStats>('/api/content-index/stats'),
  health: () => get<Record<string, unknown>>('/api/health'),
  startupDiagnostics: () => get<Record<string, unknown>>('/api/diagnostics/startup'),
  epubDiagnostics: () => get<Record<string, unknown>[]>('/api/diagnostics/epub'),
  categories: () => get<CategoryCount[]>('/api/categories'),
  open: (id: number) => post(`/api/open/${id}`),
  item: (id: number) => get<Item>(`/api/items/${id}`),
  updateItem: (id: number, updates: ItemUpdate) => put<Item>(`/api/items/${id}`, updates),
  metadataEvidence: (id: number) => get<MetadataEvidence[]>(`/api/items/${id}/evidence`),
  metadataSuggestions: (id: number) => get<MetadataSuggestion[]>(`/api/items/${id}/suggestions`),
  pendingMetadataSuggestions: () => get<PendingMetadataSuggestion[]>('/api/metadata-suggestions/pending'),
  enrich: (id: number, allowTitleLookup = true) => post<{ saved: number; suggestions: MetadataSuggestion[] }>(`/api/items/${id}/enrich`, { allow_title_lookup: allowTitleLookup }),
  extractGrobid: (id: number) => post<{ saved: number; suggestions: MetadataSuggestion[] }>(`/api/items/${id}/extract-grobid`),
  resolveSuggestion: (id: number, apply: boolean) => post<Item | null>(`/api/metadata-suggestions/${id}/${apply ? 'apply' : 'reject'}`),
  relatedCopies: (id: number) => get<Item[]>(`/api/items/${id}/related`),
  searchContent: (q: string, limit = 8) => get<ContentSearchResult[]>(`/api/search/content?q=${encodeURIComponent(q)}&limit=${limit}`),
  contentIndexState: (id: number) => get<ContentIndexState | null>(`/api/items/${id}/content-index`),
  indexContent: (id: number, ocr = false) => post<{ status: ContentIndexState['status']; chunks: number; error: string }>(`/api/items/${id}/content-index`, { ocr }),
  bulkUpdate: (ids: number[], updates: ItemUpdate) => patch<{ batch_id: string; updated: number }>('/api/items/bulk', { ids, updates }),
  undoEdits: (batchId: string) => post<{ restored: number }>(`/api/edits/${batchId}/undo`),
  delete: (id: number) => del(`/api/items/${id}`),
  scan: () => post<{ indexed: number; total: number }>('/api/scan'),
  settings: () => get<AppSettings>('/api/settings'),
  updateSettings: (settings: Pick<AppSettings, 'scan_directories' | 'catalog_page_size'>) => put<AppSettings>('/api/settings', settings),
  epubDiagnostic: (payload: Record<string, unknown>) => post<{ ok: true }>('/api/diagnostics/epub', payload),
  updateReadingPreferences: (preferences: ReaderPreferences) => put<ReaderPreferences>('/api/settings/reading', preferences),
  quit: () => post<{ status: string }>('/api/quit'),
  tags: () => get<TagCount[]>('/api/tags'),
  purposes: () => get<TagCount[]>('/api/purposes'),

  // Collections
  collections: () => get<Collection[]>('/api/collections'),
  collection: (id: number) => get<Collection>(`/api/collections/${id}`),
  collectionItems: (id: number) => get<Item[]>(`/api/collections/${id}/items`),
  createCollection: (name: string, description = '') =>
    post<Collection>('/api/collections', { name, description }),
  updateCollection: (id: number, name: string, description: string) =>
    put<Collection>(`/api/collections/${id}`, { name, description }),
  deleteCollection: (id: number) => del(`/api/collections/${id}`),
  addToCollection: (collectionId: number, itemId: number) =>
    post(`/api/collections/${collectionId}/items`, { item_id: itemId }),
  removeFromCollection: (collectionId: number, itemId: number) =>
    del(`/api/collections/${collectionId}/items/${itemId}`),
  reorderCollection: (collectionId: number, ids: number[]) => post(`/api/collections/${collectionId}/reorder`, { ids }),

  // Reading progress
  readingProgress: (id: number) => get<ReadingProgress>(`/api/reading/progress/${id}`),
  updateProgress: (id: number, progress: ReadingProgressUpdate) => post<ReadingProgress>(`/api/reading/progress/${id}`, progress),
  readingDashboard: () => get<ReadingDashboard>('/api/reading/dashboard'),

  // Reading sessions
  startReading: (id: number) => post<ReadingSession>(`/api/reading/start/${id}`),
  heartbeatReading: (id: number) => post<{ active: boolean }>(`/api/reading/heartbeat/${id}`),
  bookmarks: (id: number) => get<Bookmark[]>(`/api/reading/bookmarks/${id}`),
  addBookmark: (id: number, bookmark: Pick<Bookmark, 'location' | 'label' | 'percent'>) => post<Bookmark>(`/api/reading/bookmarks/${id}`, bookmark),
  removeBookmark: (id: number, location: string) => del<{ removed: boolean }>(`/api/reading/bookmarks/${id}?location=${encodeURIComponent(location)}`),
  annotations: (id: number) => get<Annotation[]>(`/api/reading/annotations/${id}`),
  addAnnotation: (id: number, annotation: Pick<Annotation, 'cfi_range' | 'text' | 'note'>) => post<Annotation>(`/api/reading/annotations/${id}`, annotation),
  removeAnnotation: (id: number, range: string) => del<{ removed: boolean }>(`/api/reading/annotations/${id}?cfi_range=${encodeURIComponent(range)}`),
  stopReading: (id: number, pagesRead?: number) => post(`/api/reading/stop/${id}`, { pages_read: pagesRead || 0 }),
  readingSessions: (id: number) => get<ReadingSession[]>(`/api/reading/sessions/${id}`),

  // Reading queue
  readingQueue: () => get<ReadingQueueItem[]>('/api/reading/queue'),
  addToQueue: (item: Partial<ReadingQueueItem>) => post('/api/reading/queue', item),
  removeFromQueue: (id: number) => del(`/api/reading/queue/${id}`),
  reorderQueue: (ids: number[]) => post('/api/reading/queue/reorder', { ids }),

  // Finish & sync
  finishReading: (id: number) => post<{ status: string; next_item_id: number | null }>(`/api/reading/finish/${id}`),
  dropReading: (id: number) => post(`/api/reading/drop/${id}`),
  syncFocusd: () => post<{ added: number }>('/api/reading/sync-focusd'),

  // Readest sync
  readestStatus: () => get<ReadestStatus>('/api/reading/readest-status'),
  syncReadest: () => post<ReadestSyncResult>('/api/reading/sync-readest'),
};

export interface ReadestStatus {
  enabled: boolean;
  last_sync_at: string | null;
  total_books: number;
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
