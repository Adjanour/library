import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "@std/path";
import type {
  CategoryCount,
  Bookmark,
  Item,
  ItemUpdate,
  ReadingDashboard,
  ReadingProgress,
  ReadingProgressUpdate,
  ReadingStatus,
  ReadingQueueItem,
  ReadingSession,
  SearchQuery,
  SearchResult,
  SearchItem,
  Stats,
  TagCount,
} from "./types.ts";
import {
  type AppError,
  DatabaseError,
  Err,
  fromTryCatch,
  NotFound,
  Ok,
  type Result,
  Validation,
} from "./result.ts";
import { appDataRoot } from "./platform.ts";

const DEFAULT_DB_DIR = join(
  appDataRoot(),
  "library",
);
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "library.db");

function toFTSQuery(input: string): string {
  const parts = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  return parts.map((part) => `"${part}"*`).join(" AND ");
}

type SearchCursor = {
  sort: string;
  order: "asc" | "desc";
  value: string | number;
  id: number;
};

function encodeCursor(cursor: SearchCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(value: string): SearchCursor | null {
  try {
    const raw = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as SearchCursor;
    if (!parsed || typeof parsed.id !== "number" || typeof parsed.sort !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export class DB {
  private conn: DatabaseSync;
  private _fts = false;
  private readonly dbPath: string;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      Deno.mkdirSync(dir, { recursive: true });
    }

    this.conn = new DatabaseSync(dbPath);

    this.conn.exec("PRAGMA journal_mode = WAL");
    this.conn.exec("PRAGMA busy_timeout = 5000");
    this.conn.exec("PRAGMA foreign_keys = ON");

    this.backupBeforeMigration();
    this.migrate();
    this.closeOrphanedSessions();
  }

  private schemaVersion(): number {
    const row = this.conn.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  private backupBeforeMigration(): void {
    if (this.dbPath === ":memory:" || this.schemaVersion() >= 5) return;
    const existing = this.conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'",
    ).get();
    if (!existing) return;
    const backupPath = `${this.dbPath}.bak-5`;
    try {
      Deno.statSync(backupPath);
    } catch {
      try {
        Deno.copyFileSync(this.dbPath, backupPath);
      } catch {
        // A backup is best effort; the migration itself remains atomic at the
        // statement level and will surface its own failure to the caller.
      }
    }
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

    let version = this.schemaVersion();
    if (version < 1) {
      for (const statement of [
        "ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''",
        "ALTER TABLE items ADD COLUMN purpose TEXT DEFAULT ''",
      ]) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec("PRAGMA user_version = 1");
      version = 1;
    }
    if (version < 2) {
      for (const statement of [
        "ALTER TABLE items ADD COLUMN title_source TEXT NOT NULL DEFAULT 'metadata'",
        "ALTER TABLE items ADD COLUMN locked_fields TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE items ADD COLUMN missing_at DATETIME",
        "ALTER TABLE items ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0",
      ]) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec("PRAGMA user_version = 2");
    }
    if (version < 3) {
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS edits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT NOT NULL,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.conn.exec("CREATE INDEX IF NOT EXISTS idx_edits_batch ON edits(batch_id)");
      this.conn.exec("PRAGMA user_version = 3");
    }
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
        location TEXT,
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
        pages_read INTEGER DEFAULT 0,
        last_activity_at DATETIME
      )
    `);
    if (version < 4) {
      for (const statement of [
        "ALTER TABLE reading_progress ADD COLUMN location TEXT",
        "ALTER TABLE reading_sessions ADD COLUMN last_activity_at DATETIME",
      ]) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec("UPDATE reading_sessions SET last_activity_at = COALESCE(last_activity_at, started_at) WHERE last_activity_at IS NULL");
      this.conn.exec("PRAGMA user_version = 4");
    }
    if (version < 5) {
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          location TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          percent INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(item_id, location)
        )
      `);
      this.conn.exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id)");
      this.conn.exec("PRAGMA user_version = 5");
    }
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

    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  get connection(): DatabaseSync {
    return this.conn;
  }

  getSetting(key: string): string | null {
    const row = this.conn.prepare(
      "SELECT value FROM app_settings WHERE key = ?",
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.conn.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
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
        "UPDATE items SET ignored = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(id);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("DELETE FROM items WHERE id = ?", e));
    }
  }

  permanentlyDeleteItem(id: number): Result<boolean, AppError<"DATABASE">> {
    try {
      const result = this.conn.prepare("DELETE FROM items WHERE id = ?").run(id);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("DELETE FROM items WHERE id = ?", e));
    }
  }

  restoreItem(id: number): Result<boolean, AppError<"DATABASE">> {
    try {
      const result = this.conn.prepare(
        "UPDATE items SET ignored = 0, missing_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(id);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("UPDATE items SET ignored = 0 WHERE id = ?", e));
    }
  }

  markMissing(id: number): void {
    this.conn.prepare(
      "UPDATE items SET missing_at = COALESCE(missing_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ignored = 0",
    ).run(id);
  }

  restorePath(id: number, newPath?: string): void {
    if (newPath) {
      this.conn.prepare(
        "UPDATE items SET path = ?, missing_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ignored = 0",
      ).run(newPath, id);
    } else {
      this.conn.prepare(
        "UPDATE items SET missing_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ignored = 0",
      ).run(id);
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
    if (u.path !== undefined) {
      sets.push("path = ?");
      args.push(u.path);
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
      const fields = Object.keys(u).filter((field) => field !== "path");
      if (fields.length > 0) {
        const row = this.conn.prepare(
          "SELECT locked_fields FROM items WHERE id = ?",
        ).get(id) as { locked_fields: string };
        const locked = new Set(
          row.locked_fields.split(",").map((field) => field.trim()).filter(Boolean),
        );
        for (const field of fields) locked.add(field);
        this.conn.prepare(
          "UPDATE items SET locked_fields = ?, title_source = CASE WHEN ? THEN 'manual' ELSE title_source END WHERE id = ?",
        ).run([...locked].sort().join(","), fields.includes("title") ? 1 : 0, id);
      }
      return Ok(undefined);
    } catch (e) {
      return Err(DatabaseError(query, e));
    }
  }

  bulkUpdateItems(
    ids: number[],
    updates: ItemUpdate,
  ): Result<{ batch_id: string; updated: number }, AppError<"VALIDATION" | "DATABASE">> {
    const fields = Object.keys(updates).filter((field) => field !== "path");
    if (ids.length === 0 || fields.length === 0) {
      return Err(Validation("bulk update", "ids and updates are required"));
    }
    const allowed = new Set(["title", "authors", "year", "category", "tags", "purpose", "description"]);
    if (fields.some((field) => !allowed.has(field))) {
      return Err(Validation("bulk update", "unsupported field"));
    }
    const batchId = crypto.randomUUID();
    let updated = 0;
    try {
      this.conn.exec("BEGIN");
      for (const id of [...new Set(ids)]) {
        const before = this.conn.prepare("SELECT * FROM items WHERE id = ? AND ignored = 0").get(id) as Record<string, unknown> | undefined;
        if (!before) continue;
        const result = this.updateItem(id, updates);
        if (!result.ok) throw new Error(result.error.message);
        const after = this.conn.prepare("SELECT * FROM items WHERE id = ?").get(id) as Record<string, unknown>;
        for (const field of fields) {
          this.conn.prepare(
            "INSERT INTO edits (batch_id, item_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
          ).run(batchId, id, field, before[field] as string | number | null, after[field] as string | number | null);
        }
        updated++;
      }
      this.conn.exec("COMMIT");
      return Ok({ batch_id: batchId, updated });
    } catch (e) {
      try { this.conn.exec("ROLLBACK"); } catch { /* preserve original error */ }
      return Err(DatabaseError("bulk update", e));
    }
  }

  undoEdits(batchId: string): Result<{ undone: number }, AppError<"NOT_FOUND" | "DATABASE">> {
    const edits = this.conn.prepare(
      "SELECT item_id, field, old_value FROM edits WHERE batch_id = ? ORDER BY id DESC",
    ).all(batchId) as { item_id: number; field: string; old_value: string | number | null }[];
    if (edits.length === 0) return Err(NotFound("Edit batch", batchId));
    const allowed = new Set(["title", "authors", "year", "category", "tags", "purpose", "description"]);
    try {
      this.conn.exec("BEGIN");
      for (const edit of edits) {
        if (!allowed.has(edit.field)) throw new Error(`unsupported edit field: ${edit.field}`);
        this.conn.prepare(`UPDATE items SET ${edit.field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(edit.old_value, edit.item_id);
      }
      this.conn.exec("COMMIT");
      return Ok({ undone: new Set(edits.map((edit) => edit.item_id)).size });
    } catch (e) {
      try { this.conn.exec("ROLLBACK"); } catch { /* preserve original error */ }
      return Err(DatabaseError("undo edits", e));
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

    try {
      const totalRow = this.conn.prepare("SELECT COUNT(*) as c FROM items")
        .get() as { c: number };

      stats.total_items = totalRow.c;

      const typeRows = this.conn.prepare(
        "SELECT type, COUNT(*) as c FROM items GROUP BY type",
      ).all() as { type: string; c: number }[];

      for (const row of typeRows) {
        stats.by_type[row.type] = row.c;
      }

      const categoryRows = this.conn.prepare(
        "SELECT category, COUNT(*) as c FROM items WHERE category != '' GROUP BY category ORDER BY c DESC",
      ).all() as { category: string; c: number }[];

      for (const row of categoryRows) {
        stats.by_category[row.category] = row.c;
      }

      const yearRows = this.conn.prepare(
        "SELECT CAST(year AS TEXT) as year, COUNT(*) as c FROM items WHERE year > 0 GROUP BY year",
      ).all() as { year: string; c: number }[];

      for (const row of yearRows) {
        stats.by_year[row.year] = row.c;
      }

      const recentRows = this.conn.prepare(
        "SELECT id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at FROM items ORDER BY added_at DESC LIMIT 10",
      ).all() as unknown as Item[];

      stats.recent_added = recentRows;
      return Ok(stats);
    } catch (e) {
      return Err(DatabaseError("SELECT * FROM items", e));
    }
  }

  getCategories(): Result<CategoryCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT category as name, COUNT(*) as count FROM items WHERE category != '' GROUP BY category ORDER BY count DESC",
      ).all() as unknown as CategoryCount[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT category", e));
    }
  }

  getTags(): Result<TagCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT tag as name, COUNT(*) as count FROM item_tags GROUP BY tag ORDER BY count DESC",
      ).all() as unknown as TagCount[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT tag", e));
    }
  }

  getPurposes(): Result<TagCount[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(
        "SELECT purpose as name, COUNT(*) as count FROM items WHERE purpose != '' GROUP BY purpose ORDER BY count DESC",
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
      const values = (q.types?.length ? q.types : q.type ? [q.type] : []);
      const categories = (q.categories?.length ? q.categories : q.category ? [q.category] : []);
      const tags = (q.tags?.length ? q.tags : q.tag ? [q.tag] : []);
      const purposes = (q.purposes?.length ? q.purposes : q.purpose ? [q.purpose] : []);
      const buildFilters = (exclude = ""): { clauses: string[]; args: (string | number)[] } => {
        const clauses: string[] = ["i.ignored = 0"];
        const args: (string | number)[] = [];
        if (q.q) {
          const like = `%${q.q}%`;
          if (this._fts) {
            clauses.push("(i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?) OR i.purpose LIKE ?)");
            args.push(toFTSQuery(q.q), like);
          } else {
            clauses.push("(i.title LIKE ? OR i.authors LIKE ? OR i.filename LIKE ? OR i.description LIKE ? OR i.purpose LIKE ?)");
            args.push(like, like, like, like, like);
          }
        }
        const addIn = (field: string, list: string[], key: string) => {
          if (exclude === key || list.length === 0) return;
          clauses.push(`${field} IN (${list.map(() => "?").join(",")})`);
          args.push(...list);
        };
        addIn("i.type", values, "type");
        addIn("i.category", categories, "category");
        addIn("i.purpose", purposes, "purpose");
        if (exclude !== "tag" && tags.length) {
          clauses.push(`i.id IN (SELECT item_id FROM item_tags WHERE tag IN (${tags.map(() => "?").join(",")}))`);
          args.push(...tags);
        }
        if (q.year > 0 && exclude !== "year") {
          clauses.push("i.year = ?");
          args.push(q.year);
        }
        if (q.status && exclude !== "status") {
          clauses.push("rp.status = ?");
          args.push(q.status);
        }
        return { clauses, args };
      };
      const base = buildFilters();
      const baseWhere = `WHERE ${base.clauses.join(" AND ")}`;
      const countRow = this.conn.prepare(
        `SELECT COUNT(*) as c FROM items i LEFT JOIN reading_progress rp ON rp.item_id = i.id ${baseWhere}`,
      ).get(...base.args) as { c: number };
      const total = countRow.c;

      const sort = ["year", "added", "size"].includes(q.sort) ? q.sort : "title";
      const order: "asc" | "desc" = q.order === "asc" ? "asc" : "desc";
      const effectiveOrder = sort === "title" && !q.order ? "asc" : order;
      const sortField = sort === "year" ? "i.year" : sort === "added" ? "i.added_at" : sort === "size" ? "i.size" : "i.title";
      const sortDirection = effectiveOrder.toUpperCase();
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      const queryFilters = buildFilters();
      if (cursor && cursor.sort === sort && cursor.order === effectiveOrder) {
        const comparison = effectiveOrder === "asc" ? ">" : "<";
        queryFilters.clauses.push(`(${sortField} ${comparison} ? OR (${sortField} = ? AND i.id > ?))`);
        queryFilters.args.push(cursor.value, cursor.value, cursor.id);
      }
      const whereClause = `WHERE ${queryFilters.clauses.join(" AND ")}`;
      const orderClause = `ORDER BY ${sortField} ${sortDirection}, i.id ASC`;
      const offset = cursor ? 0 : (q.page - 1) * q.limit;
      const queryParams = [...queryFilters.args, q.limit, offset];
      const rows = this.conn.prepare(
        `SELECT i.*, rp.status AS progress_status, rp.progress_percent AS progress_percent_value,
          rp.current_page AS progress_current_page, rp.total_pages AS progress_total_pages,
          rp.started_at AS progress_started_at, rp.finished_at AS progress_finished_at,
          rp.last_read_at AS progress_last_read_at, rp.updated_at AS progress_updated_at
         FROM items i LEFT JOIN reading_progress rp ON rp.item_id = i.id
         ${whereClause} ${orderClause}
         LIMIT ? OFFSET ?`,
      ).all(...queryParams) as Record<string, unknown>[];
      const items = rows.map((row) => {
        const progressStatus = row.progress_status as ReadingStatus | null;
        const {
          progress_status: _status,
          progress_percent_value: _percent,
          progress_current_page: _page,
          progress_total_pages: _total,
          progress_started_at: _started,
          progress_finished_at: _finished,
          progress_last_read_at: _lastRead,
          progress_updated_at: _updated,
          ...item
        } = row;
        const progress: ReadingProgress | null = progressStatus
          ? {
            item_id: Number(item.id),
            status: progressStatus,
            progress_percent: Number(row.progress_percent_value ?? 0),
            current_page: Number(row.progress_current_page ?? 0),
            total_pages: Number(row.progress_total_pages ?? 0),
            started_at: row.progress_started_at as string | null,
            finished_at: row.progress_finished_at as string | null,
            last_read_at: row.progress_last_read_at as string | null,
            updated_at: String(row.progress_updated_at ?? ""),
          }
          : null;
        return { ...item, progress } as SearchItem;
      });

      const totalPages = Math.ceil(total / q.limit);
      const last = items.at(-1);
      const nextCursor = rows.length === q.limit && last
        ? encodeCursor({
          sort,
          order: effectiveOrder,
          value: (last[sort === "year" ? "year" : sort === "added" ? "added_at" : sort === "size" ? "size" : "title"] as string | number),
          id: last.id,
        })
        : null;

      const facet = (field: "type" | "category" | "purpose" | "tag"): TagCount[] => {
        const facetFilters = buildFilters(field);
        const select = field === "tag" ? "it.tag" : `i.${field}`;
        const from = field === "tag"
          ? "FROM items i JOIN item_tags it ON it.item_id = i.id LEFT JOIN reading_progress rp ON rp.item_id = i.id"
          : "FROM items i LEFT JOIN reading_progress rp ON rp.item_id = i.id";
        return this.conn.prepare(
          `SELECT ${select} AS name, COUNT(DISTINCT i.id) AS count ${from} WHERE ${facetFilters.clauses.join(" AND ")} AND ${select} != '' GROUP BY ${select} ORDER BY count DESC, name ASC`,
        ).all(...facetFilters.args) as unknown as TagCount[];
      };

      return Ok({
        items,
        total,
        page: q.page,
        limit: q.limit,
        total_pages: totalPages,
        next_cursor: nextCursor,
        facets: {
          type: facet("type"),
          category: facet("category"),
          purpose: facet("purpose"),
          tag: facet("tag"),
        },
      });
    } catch (e) {
      return Err(DatabaseError("search", e));
    }
  }

  getAllPaths(): string[] {
    const rows = this.conn.prepare("SELECT path FROM items WHERE ignored = 0").all() as {
      path: string;
    }[];
    return rows.map((r) => r.path);
  }

  getAllItems(): Item[] {
    return this.conn.prepare("SELECT * FROM items").all() as unknown as Item[];
  }

  getItemByPath(path: string): Result<Item> {
    const row = this.conn.prepare("SELECT * FROM items WHERE path = ?").get(
      path,
    ) as Item | undefined;
    if (!row) return Err(NotFound("Item", path));
    return Ok(row);
  }

  updatePath(id: number, newPath: string): void {
    this.conn.prepare(
      "UPDATE items SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(newPath, id);
  }

  upsertItem(item: Item): Result<void> {
    return fromTryCatch(() => {
      const existing = this.conn.prepare(
        "SELECT * FROM items WHERE path = ?",
      ).get(item.path) as Item | undefined;
      if (!existing) {
        this.conn.prepare(`
          INSERT INTO items (title, authors, year, path, filename, type, category, tags, purpose, description, size, title_source, added_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          item.title, item.authors, item.year, item.path, item.filename,
          item.type, item.category, item.tags, item.purpose, item.description,
          item.size, item.title_source ?? "metadata",
        );
        return;
      }

      const locked = new Set(
        (existing.locked_fields ?? "").split(",").map((field) => field.trim()).filter(Boolean),
      );
      const value = (
        field: keyof Item,
        fallback: string | number | null,
      ): string | number | null =>
        locked.has(field)
          ? (existing[field] as string | number | null | undefined) ?? null
          : fallback;
      this.conn.prepare(`
        UPDATE items SET title = ?, authors = ?, year = ?, filename = ?, type = ?,
          category = ?, tags = ?, purpose = ?, description = ?, size = ?,
          missing_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        value("title", item.title), value("authors", item.authors),
        value("year", item.year), item.filename, item.type,
        value("category", item.category), value("tags", item.tags),
        value("purpose", item.purpose), value("description", item.description),
        item.size, existing.id,
      );
      if (!locked.has("title")) {
        this.conn.prepare("UPDATE items SET title_source = ? WHERE id = ?")
          .run(item.title_source ?? existing.title_source ?? "metadata", existing.id);
      }
    });
  }

  get fts(): boolean {
    return this._fts;
  }

  // Reading Progress

  getReadingProgress(itemID: number): ReadingProgress | null {
    const row = this.conn.prepare(
      "SELECT * FROM reading_progress WHERE item_id = ?",
    ).get(itemID) as unknown as ReadingProgress | undefined;
    return row ?? null;
  }

  getAllReadingProgress(): ReadingProgress[] {
    return this.conn.prepare("SELECT * FROM reading_progress")
      .all() as unknown as ReadingProgress[];
  }

  recordReadingProgress(itemID: number, update: ReadingProgressUpdate): ReadingProgress {
    const existing = this.getReadingProgress(itemID);
    const now = new Date().toISOString();
    const furthest = Math.max(existing?.progress_percent ?? 0, update.progress_percent);
    const finished = existing?.status === "finished" || furthest >= 100;
    const status: ReadingStatus = finished
      ? "finished"
      : furthest > 0
      ? "reading"
      : existing?.status === "dropped"
      ? "dropped"
      : "unread";

    if (!existing && furthest === 0) {
      return {
        item_id: itemID,
        status: "unread",
        progress_percent: 0,
        current_page: update.current_page,
        total_pages: update.total_pages,
        started_at: null,
        finished_at: null,
        last_read_at: null,
        updated_at: now,
        location: update.location ?? null,
      };
    }

    const progress: ReadingProgress = {
      item_id: itemID,
      status,
      progress_percent: furthest,
      current_page: update.current_page,
      total_pages: update.total_pages,
      started_at: existing?.started_at ?? (furthest > 0 ? now : null),
      finished_at: finished ? existing?.finished_at ?? now : null,
      last_read_at: furthest > 0 ? now : existing?.last_read_at ?? null,
      updated_at: now,
      location: update.location ?? existing?.location ?? null,
    };
    this.conn.prepare(`
      INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, started_at, finished_at, last_read_at, location, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        status = excluded.status, progress_percent = excluded.progress_percent,
        current_page = excluded.current_page, total_pages = excluded.total_pages,
        started_at = excluded.started_at, finished_at = excluded.finished_at,
        last_read_at = excluded.last_read_at,
        location = COALESCE(excluded.location, reading_progress.location),
        updated_at = excluded.updated_at
    `).run(
      progress.item_id,
      progress.status,
      progress.progress_percent,
      progress.current_page,
      progress.total_pages,
      progress.started_at,
      progress.finished_at,
      progress.last_read_at,
      progress.location ?? null,
      progress.updated_at,
    );
    return progress;
  }

  dropReading(itemID: number): void {
    const existing = this.getReadingProgress(itemID);
    if (existing) {
      this.conn.prepare(
        "UPDATE reading_progress SET status = 'dropped', updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
      ).run(itemID);
      return;
    }
    this.conn.prepare(`
      INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, updated_at)
      VALUES (?, 'dropped', 0, 0, 0, CURRENT_TIMESTAMP)
    `).run(itemID);
  }

  upsertReadingProgress(p: ReadingProgress): void {
    const existing = this.getReadingProgress(p.item_id);
    const percent = Math.max(0, Math.min(100, p.progress_percent));
    const now = new Date().toISOString();
    const finished = percent >= 100;
    const status: ReadingStatus = finished
      ? "finished"
      : percent > 0
      ? "reading"
      : "unread";
    // Opening a book is not reading activity. Avoid creating an empty row
    // until the reader reports real progress.
    if (!existing && percent === 0) return;
    this.conn.prepare(`
      INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, started_at, finished_at, last_read_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(item_id) DO UPDATE SET
        status = excluded.status, progress_percent = excluded.progress_percent,
        current_page = excluded.current_page, total_pages = excluded.total_pages,
        started_at = COALESCE(excluded.started_at, reading_progress.started_at),
        finished_at = excluded.finished_at,
        last_read_at = COALESCE(excluded.last_read_at, reading_progress.last_read_at),
        updated_at = CURRENT_TIMESTAMP
    `).run(
      p.item_id,
      status,
      percent,
      p.current_page,
      p.total_pages,
      p.started_at ?? existing?.started_at ?? (percent > 0 ? now : null),
      finished ? p.finished_at ?? existing?.finished_at ?? now : null,
      p.last_read_at ?? (percent > 0 ? now : existing?.last_read_at ?? null),
    );
  }

  // Reading Sessions

  startReadingSession(itemID: number): ReadingSession {
    const active = this.getActiveSession(itemID);
    if (active) {
      this.touchReadingSession(itemID);
      return this.getActiveSession(itemID) ?? active;
    }
    const result = this.conn.prepare(`
      INSERT INTO reading_sessions (item_id, started_at, last_activity_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(itemID);
    const id = Number(result.lastInsertRowid);
    return this.conn.prepare("SELECT * FROM reading_sessions WHERE id = ?").get(
      id,
    ) as unknown as ReadingSession;
  }

  touchReadingSession(itemID: number): boolean {
    const result = this.conn.prepare(`
      UPDATE reading_sessions
      SET duration_seconds = duration_seconds + MIN(90, MAX(0, CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(last_activity_at, started_at))) * 86400 AS INTEGER))),
          last_activity_at = CURRENT_TIMESTAMP
      WHERE item_id = ? AND ended_at IS NULL
    `).run(itemID);
    return result.changes > 0;
  }

  closeOrphanedSessions(staleMinutes = 30): number {
    const result = this.conn.prepare(`
      UPDATE reading_sessions
      SET ended_at = CURRENT_TIMESTAMP
      WHERE ended_at IS NULL
        AND COALESCE(last_activity_at, started_at) < datetime('now', ?)
    `).run(`-${staleMinutes} minutes`);
    return Number(result.changes);
  }

  closeActiveSessions(): number {
    const result = this.conn.prepare(`
      UPDATE reading_sessions
      SET ended_at = CURRENT_TIMESTAMP,
          duration_seconds = duration_seconds + MIN(90, MAX(0, CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(last_activity_at, started_at))) * 86400 AS INTEGER)))
      WHERE ended_at IS NULL
    `).run();
    return Number(result.changes);
  }

  getBookmarks(itemID: number): Bookmark[] {
    return this.conn.prepare(
      "SELECT * FROM bookmarks WHERE item_id = ? ORDER BY created_at DESC, id DESC",
    ).all(itemID) as unknown as Bookmark[];
  }

  addBookmark(itemID: number, location: string, label: string, percent: number): Bookmark {
    this.conn.prepare(`
      INSERT INTO bookmarks (item_id, location, label, percent)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id, location) DO UPDATE SET label = excluded.label, percent = excluded.percent
    `).run(itemID, location, label, percent);
    return this.conn.prepare(
      "SELECT * FROM bookmarks WHERE item_id = ? AND location = ?",
    ).get(itemID, location) as unknown as Bookmark;
  }

  removeBookmark(itemID: number, location: string): boolean {
    const result = this.conn.prepare(
      "DELETE FROM bookmarks WHERE item_id = ? AND location = ?",
    ).run(itemID, location);
    return Number(result.changes) > 0;
  }

  stopReadingSession(sessionID: number, pagesRead: number): void {
    const session = this.conn.prepare(
      "SELECT item_id FROM reading_sessions WHERE id = ? AND ended_at IS NULL",
    ).get(sessionID) as { item_id: number } | undefined;
    if (session) this.touchReadingSession(session.item_id);
    this.conn.prepare(`
      UPDATE reading_sessions SET ended_at = CURRENT_TIMESTAMP, pages_read = ? WHERE id = ? AND ended_at IS NULL
    `).run(pagesRead, sessionID);
  }

  getActiveSession(itemID: number): ReadingSession | null {
    const row = this.conn.prepare(
      "SELECT * FROM reading_sessions WHERE item_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    ).get(itemID) as ReadingSession | undefined;
    return row ?? null;
  }

  getReadingSessions(itemID: number, limit: number): ReadingSession[] {
    return this.conn.prepare(
      "SELECT * FROM reading_sessions WHERE item_id = ? ORDER BY started_at DESC LIMIT ?",
    ).all(itemID, limit) as unknown as ReadingSession[];
  }

  // Reading Queue

  getReadingQueue(): ReadingQueueItem[] {
    return this.conn.prepare(
      "SELECT q.*, i.path as file_path, i.filename, i.type as file_type FROM reading_queue q LEFT JOIN items i ON q.item_id = i.id ORDER BY q.priority",
    ).all() as unknown as ReadingQueueItem[];
  }

  addToReadingQueue(item: ReadingQueueItem): void {
    if (item.item_id !== null && item.item_id !== undefined) {
      const existing = this.conn.prepare(
        "SELECT id FROM reading_queue WHERE item_id = ? LIMIT 1",
      ).get(item.item_id) as { id: number } | undefined;
      if (existing) {
        item.id = existing.id;
        return;
      }
    }
    if (item.priority === 0) {
      const next = this.conn.prepare(
        "SELECT COALESCE(MAX(priority) + 1, 0) as priority FROM reading_queue",
      ).get() as { priority: number };
      item.priority = next.priority;
    }
    this.conn.prepare(`
      INSERT INTO reading_queue (item_id, focusd_book_number, title, author, priority) VALUES (?, ?, ?, ?, ?)
    `).run(
      item.item_id,
      item.focusd_book_number,
      item.title,
      item.author,
      item.priority,
    );
  }

  removeFromReadingQueue(id: number): void {
    this.conn.prepare("DELETE FROM reading_queue WHERE id = ?").run(id);
  }

  reorderReadingQueue(ids: number[]): void {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id !== undefined) {
        this.conn.prepare("UPDATE reading_queue SET priority = ? WHERE id = ?")
          .run(i, id);
      }
    }
  }

  // Reading Finish

  finishReading(itemID: number): void {
    const current = this.getReadingProgress(itemID);
    this.upsertReadingProgress({
      item_id: itemID,
      status: "finished",
      progress_percent: 100,
      current_page: current?.current_page ?? 0,
      total_pages: current?.total_pages ?? 0,
      started_at: current?.started_at ?? null,
      finished_at: new Date().toISOString(),
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.conn.prepare("DELETE FROM reading_queue WHERE item_id = ?").run(
      itemID,
    );
    const session = this.getActiveSession(itemID);
    if (session) {
      this.stopReadingSession(session.id, 0);
    }
  }

  // Dashboard

  getReadingDashboard(): ReadingDashboard {
    const currentlyReading = this.conn.prepare(`
      SELECT i.*, rp.status, rp.progress_percent, rp.current_page, rp.total_pages, rp.started_at, rp.finished_at, rp.last_read_at, rp.updated_at
      FROM reading_progress rp JOIN items i ON rp.item_id = i.id WHERE rp.status = 'reading' AND i.ignored = 0
      ORDER BY COALESCE(rp.last_read_at, rp.updated_at) DESC, i.id ASC
    `).all() as unknown as (Item & ReadingProgress)[];

    const queue = this.getReadingQueue();
    const totalReadBooks = (this.conn.prepare(
      "SELECT COUNT(*) as c FROM reading_progress WHERE status = 'finished'",
    ).get() as { c: number }).c;
    const todayMinutes = this.conn.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) / 60 as m FROM reading_sessions WHERE started_at >= date('now', 'start of day')
    `).get() as { m: number };
    const weekMinutes = this.conn.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) / 60 as m FROM reading_sessions WHERE started_at >= date('now', 'weekday 0', '-7 days')
    `).get() as { m: number };

    return {
      currently_reading: currentlyReading.map((r) => ({
        item: {
          id: r.id,
          title: r.title,
          authors: r.authors,
          year: r.year,
          path: r.path,
          filename: r.filename,
          type: r.type,
          category: r.category,
          tags: r.tags,
          purpose: r.purpose,
          description: r.description,
          size: r.size,
          added_at: r.added_at,
          updated_at: r.updated_at,
        },
        progress: {
          item_id: r.item_id,
          status: r.status,
          progress_percent: r.progress_percent,
          current_page: r.current_page,
          total_pages: r.total_pages,
          started_at: r.started_at,
          finished_at: r.finished_at,
          last_read_at: r.last_read_at,
          updated_at: r.updated_at,
        },
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
