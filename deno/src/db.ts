import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "@std/path";
import type {
  CategoryCount,
  Item,
  ItemUpdate,
  ReadingDashboard,
  ReadingProgress,
  ReadingQueueItem,
  ReadingSession,
  SearchQuery,
  SearchResult,
  Stats,
  TagCount,
} from "./types.ts";
import {
  AppError,
  DatabaseError,
  Err,
  fromTryCatch,
  NotFound,
  Ok,
  type Result,
  Validation,
} from "./result.ts";

const DEFAULT_DB_DIR = join(
  Deno.env.get("HOME") ?? "~",
  ".local",
  "share",
  "library",
);
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "library.db");

function toFTSQuery(input: string): string {
  const parts = input.split(/\s+/).filter(Boolean);
  return parts.map((p) => p.replace(/['"*]+/g, "") + "*").join(" AND ");
}

export class DB {
  private conn: DatabaseSync;
  private _fts = false;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      Deno.mkdirSync(dir, { recursive: true });
    }

    this.conn = new DatabaseSync(dbPath);

    this.conn.exec("PRAGMA journal_mode = WAL");
    this.conn.exec("PRAGMA busy_timeout = 5000");
    this.conn.exec("PRAGMA foreign_keys = ON");

    this.migrate();
  }

  private migrate(): void {
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        authors TEXT DEFAULT '',
        year INTEGER DEFAULT 0,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        category TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        purpose TEXT DEFAULT '',
        description TEXT DEFAULT '',
        size INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)");
    this.conn.exec(
      "CREATE INDEX IF NOT EXISTS idx_items_category ON items(category)",
    );
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_year ON items(year)");
    this.conn.exec(
      "CREATE INDEX IF NOT EXISTS idx_items_title ON items(title)",
    );

    try {
      this.conn.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
          title, authors, filename, description,
          content = 'items',
          content_rowid = 'id',
          tokenize = 'porter unicode61'
        )
      `);
      this._fts = true;
    } catch {
      console.warn("FTS5 not available, using LIKE fallback for search");
      this._fts = false;
    }

    if (this._fts) {
      const row = this.conn.prepare("SELECT COUNT(*) as c FROM items_fts")
        .get() as { c: number };
      const count = row.c;
      if (count === 0) {
        this.conn.exec(`
          INSERT INTO items_fts(rowid, title, authors, filename, description)
          SELECT id, title, authors, filename, description FROM items
        `);
      }

      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
          INSERT INTO items_fts(rowid, title, authors, filename, description)
          VALUES (new.id, new.title, new.authors, new.filename, new.description);
        END
      `);
      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description)
          VALUES('delete', old.id, old.title, old.authors, old.filename, old.description);
        END
      `);
      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description)
          VALUES('delete', old.id, old.title, old.authors, old.filename, old.description);
          INSERT INTO items_fts(rowid, title, authors, filename, description)
          VALUES (new.id, new.title, new.authors, new.filename, new.description);
        END
      `);
    }

    try {
      this.conn.exec(
        "ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''",
      );
    } catch { /* exists */ }
    try {
      this.conn.exec("ALTER TABLE items ADD COLUMN purpose TEXT DEFAULT ''");
    } catch { /* exists */ }

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS item_tags (
        item_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (item_id, tag),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      )
    `);

    const tagRow = this.conn.prepare("SELECT COUNT(*) as c FROM item_tags")
      .get() as { c: number };
    const tagCount = tagRow.c;
    if (tagCount === 0) {
      const rows = this.conn.prepare(
        "SELECT id, tags FROM items WHERE tags != ''",
      ).all() as { id: number; tags: string }[];
      for (const row of rows) {
        for (const t of row.tags.split(",")) {
          const trimmed = t.trim();
          if (trimmed) {
            this.conn.prepare(
              "INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)",
            ).run(row.id, trimmed);
          }
        }
      }
    }

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_progress (
        item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'unread',
        progress_percent INTEGER DEFAULT 0,
        current_page INTEGER DEFAULT 0,
        total_pages INTEGER DEFAULT 0,
        started_at DATETIME,
        finished_at DATETIME,
        last_read_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        started_at DATETIME NOT NULL,
        ended_at DATETIME,
        duration_seconds INTEGER DEFAULT 0,
        pages_read INTEGER DEFAULT 0
      )
    `);
    this.conn.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_item ON reading_sessions(item_id)",
    );

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS reading_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        focusd_book_number INTEGER,
        title TEXT NOT NULL,
        author TEXT DEFAULT '',
        priority INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  get connection(): DatabaseSync {
    return this.conn;
  }

  getItem(id: number): Result<Item, AppError<"NOT_FOUND" | "DATABASE">> {
    try {
      const row = this.conn.prepare("SELECT * FROM items WHERE id = ?").get(
        id,
      ) as Item | undefined;
      if (!row) return Err(NotFound("Item", id));
      return Ok(row);
    } catch (e) {
      return Err(DatabaseError("SELECT * FROM items WHERE id = ?", e));
    }
  }

  deleteItem(id: number): Result<boolean, AppError<"DATABASE">> {
    try {
      const result = this.conn.prepare(
        "DELETE FROM items WHERE id = ?",
      ).run(id);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("DELETE FROM items WHERE id = ?", e));
    }
  }

  updateItem(
    id: number,
    u: ItemUpdate,
  ): Result<void, AppError<"NOT_FOUND" | "VALIDATION" | "DATABASE">> {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];

    if (u.title !== undefined) {
      sets.push("title = ?");
      args.push(u.title);
    }
    if (u.authors !== undefined) {
      sets.push("authors = ?");
      args.push(u.authors);
    }
    if (u.year !== undefined) {
      sets.push("year = ?");
      args.push(u.year);
    }
    if (u.category !== undefined) {
      sets.push("category = ?");
      args.push(u.category);
    }
    if (u.tags !== undefined) {
      sets.push("tags = ?");
      args.push(u.tags);
    }
    if (u.purpose !== undefined) {
      sets.push("purpose = ?");
      args.push(u.purpose);
    }
    if (u.description !== undefined) {
      sets.push("description = ?");
      args.push(u.description);
    }

    if (sets.length === 0) {
      return Err(Validation("update", "no fields provided"));
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    args.push(id);

    const query = `UPDATE items SET ${sets.join(", ")} WHERE id = ?`;

    try {
      const result = this.conn.prepare(query).run(...args);
      if (result.changes === 0) return Err(NotFound("Item", id));
      return Ok(undefined);
    } catch (e) {
      return Err(DatabaseError(query, e));
    }
  }

  getStats(): Result<Stats, AppError<"DATABASE">> {
    const stats: Stats = {
      total_items: 0,
      by_type: {},
      by_category: {},
      by_year: {},
      recent_added: [],
    };

     try{
      const totalRow = this.conn.prepare("SELECT COUNT(*) as c FROM items").get() as { c: number };

      stats.total_items = totalRow.c;

      const typeRows = this.conn.prepare("SELECT type, COUNT(*) as c FROM items GROUP BY type").all() as { type: string; c: number }[];

      for (const row of typeRows) {
        stats.by_type[row.type] = row.c;
      }

      const categoryRows = this.conn.prepare("SELECT category, COUNT(*) as c FROM items WHERE category != '' GROUP BY category ORDER BY c DESC").all() as { category: string; c: number }[];

      for (const row of categoryRows) {
        stats.by_category[row.category] = row.c;
      }

      const yearRows = this.conn.prepare("SELECT CAST(year AS TEXT) as year, COUNT(*) as c FROM items WHERE year > 0 GROUP BY year").all() as { year: string; c: number }[];

      for (const row of yearRows) {
        stats.by_year[row.year] = row.c;
      }

      const recentRows = this.conn.prepare("SELECT id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at FROM items ORDER BY added_at DESC LIMIT 10").all() as unknown as Item[];

      stats.recent_added = recentRows;
      return Ok(stats);

     } catch(e){
        return Err(DatabaseError("SELECT * FROM items", e))
     }
  }

  getCategories(): Result<CategoryCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT category as name, COUNT(*) as count FROM items WHERE category != '' GROUP BY category ORDER BY count DESC"
      ).all() as unknown as CategoryCount[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT category", e));
    }
  }

  getTags(): Result<TagCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT tag as name, COUNT(*) as count FROM item_tags GROUP BY tag ORDER BY count DESC"
      ).all() as unknown as TagCount[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT tag", e));
    }
  }

  getPurposes(): Result<TagCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT purpose as name, COUNT(*) as count FROM items WHERE purpose != '' GROUP BY purpose ORDER BY count DESC"
      ).all() as unknown as TagCount[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT purpose", e));
    }
  }

  search(q: SearchQuery): Result<SearchResult, AppError<"DATABASE">> {
    try {
      if (q.page < 1) q.page = 1;
      if (q.limit < 1 || q.limit > 100) q.limit = 20;

      const where: string[] = [];
      const args: (string | number)[] = [];

      if (q.q) {
        const like = `%${q.q}%`;
        if (this._fts) {
          where.push("(id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?) OR purpose LIKE ?)");
          args.push(toFTSQuery(q.q), like);
        } else {
          where.push("(title LIKE ? OR authors LIKE ? OR filename LIKE ? OR description LIKE ? OR purpose LIKE ?)");
          args.push(like, like, like, like, like);
        }
      }
      if (q.type) { where.push("type = ?"); args.push(q.type); }
      if (q.category) { where.push("category = ?"); args.push(q.category); }
      if (q.tag) { where.push("id IN (SELECT item_id FROM item_tags WHERE tag = ?)"); args.push(q.tag); }
      if (q.purpose) { where.push("purpose = ?"); args.push(q.purpose); }
      if (q.year > 0) { where.push("year = ?"); args.push(q.year); }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      let orderClause = "ORDER BY title ASC";
      switch (q.sort) {
        case "year": orderClause = "ORDER BY year DESC"; break;
        case "added": orderClause = "ORDER BY added_at DESC"; break;
        case "size": orderClause = "ORDER BY size DESC"; break;
      }
      if (q.order === "asc" && q.sort) {
        orderClause = orderClause.replace("DESC", "ASC");
      }

      const countRow = this.conn.prepare(
        `SELECT COUNT(*) as c FROM items ${whereClause}`
      ).get(...args) as { c: number };
      const total = countRow.c;

      const offset = (q.page - 1) * q.limit;
      const queryParams = [...args, q.limit, offset];
      const items = this.conn.prepare(
        `SELECT * FROM items ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
      ).all(...queryParams) as unknown as Item[];

      const totalPages = Math.ceil(total / q.limit);

      return Ok({ items, total, page: q.page, limit: q.limit, total_pages: totalPages });
    } catch (e) {
      return Err(DatabaseError("search", e));
    }
  }

  getAllPaths(): string[] {
    const rows = this.conn.prepare("SELECT path FROM items").all() as { path: string }[];
    return rows.map((r) => r.path);
  }

  upsertItem(item: Item): Result<void> {
    return fromTryCatch(() => {
      this.conn.prepare(`
        INSERT INTO items (title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(path) DO UPDATE SET
          title = excluded.title, authors = excluded.authors, year = excluded.year,
          filename = excluded.filename, type = excluded.type, category = excluded.category,
          tags = excluded.tags, purpose = excluded.purpose, description = excluded.description,
          size = excluded.size, updated_at = CURRENT_TIMESTAMP
      `).run(
        item.title, item.authors, item.year, item.path, item.filename,
        item.type, item.category, item.tags, item.purpose, item.description, item.size,
      );
    });
  }

  get fts(): boolean {
    return this._fts;
  }

  // Reading Progress

  getReadingProgress(itemID: number): ReadingProgress | null {
    const row = this.conn.prepare(
      "SELECT * FROM reading_progress WHERE item_id = ?"
    ).get(itemID) as unknown as ReadingProgress | undefined;
    return row ?? null;
  }

  getAllReadingProgress(): ReadingProgress[] {
    return this.conn.prepare("SELECT * FROM reading_progress").all() as unknown as ReadingProgress[];
  }

  upsertReadingProgress(p: ReadingProgress): void {
    this.conn.prepare(`
      INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, started_at, finished_at, last_read_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(item_id) DO UPDATE SET
        status = excluded.status, progress_percent = excluded.progress_percent,
        current_page = excluded.current_page, total_pages = excluded.total_pages,
        started_at = COALESCE(excluded.started_at, reading_progress.started_at),
        finished_at = COALESCE(excluded.finished_at, reading_progress.finished_at),
        last_read_at = COALESCE(excluded.last_read_at, reading_progress.last_read_at),
        updated_at = CURRENT_TIMESTAMP
    `).run(p.item_id, p.status, p.progress_percent, p.current_page, p.total_pages, p.started_at, p.finished_at, p.last_read_at);
  }

  // Reading Sessions

  startReadingSession(itemID: number): ReadingSession {
    const result = this.conn.prepare(`
      INSERT INTO reading_sessions (item_id, started_at) VALUES (?, CURRENT_TIMESTAMP)
    `).run(itemID);
    const id = Number(result.lastInsertRowid);
    this.conn.prepare(`
      UPDATE reading_progress SET status = 'reading', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE item_id = ?
    `).run(itemID);
    return this.conn.prepare("SELECT * FROM reading_sessions WHERE id = ?").get(id) as unknown as ReadingSession;
  }

  stopReadingSession(sessionID: number, pagesRead: number): void {
    this.conn.prepare(`
      UPDATE reading_sessions SET ended_at = CURRENT_TIMESTAMP, pages_read = ?, duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER) WHERE id = ?
    `).run(pagesRead, sessionID);
  }

  getActiveSession(itemID: number): ReadingSession | null {
    const row = this.conn.prepare(
      "SELECT * FROM reading_sessions WHERE item_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).get(itemID) as ReadingSession | undefined;
    return row ?? null;
  }

  getReadingSessions(itemID: number, limit: number): ReadingSession[] {
    return this.conn.prepare(
      "SELECT * FROM reading_sessions WHERE item_id = ? ORDER BY started_at DESC LIMIT ?"
    ).all(itemID, limit) as unknown as ReadingSession[];
  }

  // Reading Queue

  getReadingQueue(): ReadingQueueItem[] {
    return this.conn.prepare(
      "SELECT q.*, i.path as file_path, i.filename, i.type as file_type FROM reading_queue q LEFT JOIN items i ON q.item_id = i.id ORDER BY q.priority"
    ).all() as unknown as ReadingQueueItem[];
  }

  addToReadingQueue(item: ReadingQueueItem): void {
    this.conn.prepare(`
      INSERT INTO reading_queue (item_id, focusd_book_number, title, author, priority) VALUES (?, ?, ?, ?, ?)
    `).run(item.item_id, item.focusd_book_number, item.title, item.author, item.priority);
  }

  removeFromReadingQueue(id: number): void {
    this.conn.prepare("DELETE FROM reading_queue WHERE id = ?").run(id);
  }

  reorderReadingQueue(ids: number[]): void {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id !== undefined) {
        this.conn.prepare("UPDATE reading_queue SET priority = ? WHERE id = ?").run(i, id);
      }
    }
  }

  // Reading Finish

  finishReading(itemID: number): void {
    this.conn.prepare(`
      UPDATE reading_progress SET status = 'finished', progress_percent = 100, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?
    `).run(itemID);
    const session = this.getActiveSession(itemID);
    if (session) {
      this.stopReadingSession(session.id, 0);
    }
  }

  // Dashboard

  getReadingDashboard(): ReadingDashboard {
    const currentlyReading = this.conn.prepare(`
      SELECT i.*, rp.status, rp.progress_percent, rp.current_page, rp.total_pages, rp.started_at, rp.finished_at, rp.last_read_at, rp.updated_at
      FROM reading_progress rp JOIN items i ON rp.item_id = i.id WHERE rp.status = 'reading'
    `).all() as unknown as (Item & ReadingProgress)[];

    const queue = this.getReadingQueue();
    const totalReadBooks = (this.conn.prepare("SELECT COUNT(*) as c FROM reading_progress WHERE status = 'finished'").get() as { c: number }).c;
    const todayMinutes = this.conn.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) / 60 as m FROM reading_sessions WHERE started_at >= date('now', 'start of day')
    `).get() as { m: number };
    const weekMinutes = this.conn.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) / 60 as m FROM reading_sessions WHERE started_at >= date('now', 'weekday 0', '-7 days')
    `).get() as { m: number };

    return {
      currently_reading: currentlyReading.map((r) => ({
        item: { id: r.id, title: r.title, authors: r.authors, year: r.year, path: r.path, filename: r.filename, type: r.type, category: r.category, tags: r.tags, purpose: r.purpose, description: r.description, size: r.size, added_at: r.added_at, updated_at: r.updated_at },
        progress: { item_id: r.item_id, status: r.status, progress_percent: r.progress_percent, current_page: r.current_page, total_pages: r.total_pages, started_at: r.started_at, finished_at: r.finished_at, last_read_at: r.last_read_at, updated_at: r.updated_at },
        today_minutes: 0,
        total_minutes: 0,
      })),
      queue,
      total_read_books: totalReadBooks,
      total_reading_minutes: 0,
      today_reading_minutes: todayMinutes.m,
      week_reading_minutes: weekMinutes.m,
    };
  }

  close(): void {
    this.conn.close();
  }
}
