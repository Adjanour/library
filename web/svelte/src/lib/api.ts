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
  size: number;
  added_at: string;
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
}

export interface Stats {
  total_items: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
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
}

export interface ReadingSession {
  id: number;
  item_id: number;
  started_at: string;
  ended_at: string;
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
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  search: (q: string, opts?: { type?: string; category?: string; tag?: string; purpose?: string; sort?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (opts?.type) params.set('type', opts.type);
    if (opts?.category) params.set('category', opts.category);
    if (opts?.tag) params.set('tag', opts.tag);
    if (opts?.purpose) params.set('purpose', opts.purpose);
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.page) params.set('page', String(opts.page));
    return get<SearchResult>('/api/search?' + params);
  },
  stats: () => get<Stats>('/api/stats'),
  categories: () => get<CategoryCount[]>('/api/categories'),
  open: (id: number) => post(`/api/open/${id}`),
  item: (id: number) => get<Item>(`/api/items/${id}`),
  updateItem: (id: number, updates: ItemUpdate) => put<Item>(`/api/items/${id}`, updates),
  delete: (id: number) => del(`/api/items/${id}`),
  scan: () => post<{ indexed: number; total: number }>('/api/scan'),
  tags: () => get<TagCount[]>('/api/tags'),
  purposes: () => get<TagCount[]>('/api/purposes'),

  // Reading progress
  readingProgress: (id: number) => get<ReadingProgress>(`/api/reading/progress/${id}`),
  updateProgress: (id: number, progress: Partial<ReadingProgress>) => post(`/api/reading/progress/${id}`, progress),
  readingDashboard: () => get<ReadingDashboard>('/api/reading/dashboard'),

  // Reading sessions
  startReading: (id: number) => post<ReadingSession>(`/api/reading/start/${id}`),
  stopReading: (id: number, pagesRead?: number) => post(`/api/reading/stop/${id}`, { pages_read: pagesRead || 0 }),
  readingSessions: (id: number) => get<ReadingSession[]>(`/api/reading/sessions/${id}`),

  // Reading queue
  readingQueue: () => get<ReadingQueueItem[]>('/api/reading/queue'),
  addToQueue: (item: Partial<ReadingQueueItem>) => post('/api/reading/queue', item),
  removeFromQueue: (id: number) => del(`/api/reading/queue/${id}`),
  reorderQueue: (ids: number[]) => post('/api/reading/queue/reorder', { ids }),

  // Finish & sync
  finishReading: (id: number) => post(`/api/reading/finish/${id}`),
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
