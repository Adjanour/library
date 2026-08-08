import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "@std/path";
import type {
  CategoryCount,
  Item,
  ItemUpdate,
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

  get fts(): boolean {
    return this._fts;
  }

  close(): void {
    this.conn.close();
  }
}
