import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "@std/path";
import type {
  Bookmark,
  Annotation,
  CategoryCount,
  Collection,
  Item,
  ItemUpdate,
  ContentIndexState,
  ContentIndexStats,
  ContentSearchResult,
  DocumentChunk,
  MetadataSuggestion,
  PendingMetadataSuggestion,
  MetadataEvidence,
  ReadingDashboard,
  ReadingProgress,
  ReadingProgressUpdate,
  ReadingQueueItem,
  ReadingSession,
  ReadingStatus,
  SearchItem,
  SearchQuery,
  SearchResult,
  Stats,
  TagCount,
} from "./types.ts";
import {
  AlreadyExists,
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

export type QueueItemInput =
  & Pick<ReadingQueueItem, "title" | "author">
  & Partial<
    Pick<
      ReadingQueueItem,
      "id" | "item_id" | "focusd_book_number" | "priority" | "added_at"
    >
  >;

function encodeCursor(cursor: SearchCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeCursor(value: string): SearchCursor | null {
  try {
    const raw = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as SearchCursor;
    if (
      !parsed || typeof parsed.id !== "number" ||
      typeof parsed.sort !== "string"
    ) return null;
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

  private readSchemaVersion(): number {
    const row = this.conn.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  get schemaVersion(): number {
    return this.readSchemaVersion();
  }

  private backupBeforeMigration(): void {
    const version = this.readSchemaVersion();
    if (this.dbPath === ":memory:" || version >= 9) return;
    const existing = this.conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'",
    ).get();
    if (!existing) return;
    const backupPaths = [`${this.dbPath}.bak-9`];
    if (version < 8) backupPaths.push(`${this.dbPath}.bak-8`);
    if (version < 7) backupPaths.push(`${this.dbPath}.bak-7`);
    if (version < 5) backupPaths.push(`${this.dbPath}.bak-5`);
    for (const backupPath of backupPaths) {
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

    let version = this.readSchemaVersion();
    if (version < 1) {
      for (
        const statement of [
          "ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''",
          "ALTER TABLE items ADD COLUMN purpose TEXT DEFAULT ''",
        ]
      ) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec("PRAGMA user_version = 1");
      version = 1;
    }
    if (version < 2) {
      for (
        const statement of [
          "ALTER TABLE items ADD COLUMN title_source TEXT NOT NULL DEFAULT 'metadata'",
          "ALTER TABLE items ADD COLUMN locked_fields TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN missing_at DATETIME",
          "ALTER TABLE items ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0",
        ]
      ) {
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
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_edits_batch ON edits(batch_id)",
      );
      this.conn.exec("PRAGMA user_version = 3");
    }
    const needsMetadataV7 = version < 7;
    if (needsMetadataV7) {
      for (
        const statement of [
          "ALTER TABLE items ADD COLUMN publisher TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN language TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN doi TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN isbn TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN arxiv_id TEXT NOT NULL DEFAULT ''",
          "ALTER TABLE items ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
        ]
      ) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS metadata_evidence (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          value TEXT NOT NULL,
          source TEXT NOT NULL,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          extractor_version TEXT NOT NULL,
          observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(item_id, field, value, source, extractor_version)
        )
      `);
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_metadata_evidence_item ON metadata_evidence(item_id, field)",
      );
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_items_content_hash ON items(content_hash)",
      );
      this.conn.exec("CREATE INDEX IF NOT EXISTS idx_items_doi ON items(doi)");
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_items_isbn ON items(isbn)",
      );
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_items_arxiv_id ON items(arxiv_id)",
      );
      this.conn.exec("DROP TRIGGER IF EXISTS items_ai");
      this.conn.exec("DROP TRIGGER IF EXISTS items_ad");
      this.conn.exec("DROP TRIGGER IF EXISTS items_au");
      this.conn.exec("DROP TABLE IF EXISTS items_fts");
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
          title, authors, filename, description, publisher, doi, isbn,
          arxiv_id, purpose, category,
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
      if (needsMetadataV7) {
        // External-content FTS tables expose rows from `items` even before
        // their token index exists. SQLite's rebuild command is required
        // after replacing the table during this migration.
        this.conn.exec("INSERT INTO items_fts(items_fts) VALUES('rebuild')");
      }
      const row = this.conn.prepare("SELECT COUNT(*) as c FROM items_fts")
        .get() as { c: number };
      const count = row.c;
      if (count === 0) {
        this.conn.exec(`
          INSERT INTO items_fts(rowid, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category)
          SELECT id, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category FROM items
        `);
      }

      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
          INSERT INTO items_fts(rowid, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category)
          VALUES (new.id, new.title, new.authors, new.filename, new.description, new.publisher, new.doi, new.isbn, new.arxiv_id, new.purpose, new.category);
        END
      `);
      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category)
          VALUES('delete', old.id, old.title, old.authors, old.filename, old.description, old.publisher, old.doi, old.isbn, old.arxiv_id, old.purpose, old.category);
        END
      `);
      this.conn.exec(`
        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category)
          VALUES('delete', old.id, old.title, old.authors, old.filename, old.description, old.publisher, old.doi, old.isbn, old.arxiv_id, old.purpose, old.category);
          INSERT INTO items_fts(rowid, title, authors, filename, description, publisher, doi, isbn, arxiv_id, purpose, category)
          VALUES (new.id, new.title, new.authors, new.filename, new.description, new.publisher, new.doi, new.isbn, new.arxiv_id, new.purpose, new.category);
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
      for (
        const statement of [
          "ALTER TABLE reading_progress ADD COLUMN location TEXT",
          "ALTER TABLE reading_sessions ADD COLUMN last_activity_at DATETIME",
        ]
      ) {
        try {
          this.conn.exec(statement);
        } catch { /* column already exists */ }
      }
      this.conn.exec(
        "UPDATE reading_sessions SET last_activity_at = COALESCE(last_activity_at, started_at) WHERE last_activity_at IS NULL",
      );
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
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id)",
      );
      this.conn.exec("PRAGMA user_version = 5");
    }
    if (version < 6) {
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS collection_items (
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (collection_id, item_id)
        )
      `);
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_collection_items_item ON collection_items(item_id)",
      );
      this.conn.exec("PRAGMA user_version = 6");
    }
    if (needsMetadataV7) {
      this.conn.exec("PRAGMA user_version = 7");
    }
    if (version < 8) {
      this.conn.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
          item_id UNINDEXED,
          location UNINDEXED,
          heading,
          content,
          tokenize = 'porter unicode61'
        )
      `);
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS document_index_state (
          item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          error TEXT NOT NULL DEFAULT ''
        )
      `);
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_document_index_state_status ON document_index_state(status)",
      );
      this.conn.exec("PRAGMA user_version = 8");
    }
    if (version < 9) {
      this.conn.exec(`
        CREATE TABLE IF NOT EXISTS metadata_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          value TEXT NOT NULL,
          source TEXT NOT NULL,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          details_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          UNIQUE(item_id, field, value, source)
        )
      `);
      this.conn.exec(
        "CREATE INDEX IF NOT EXISTS idx_metadata_suggestions_item ON metadata_suggestions(item_id, status)",
      );
      this.conn.exec("PRAGMA user_version = 9");
    }
    if (version < 10) {
      this.conn.exec("ALTER TABLE collection_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      this.conn.exec("UPDATE collection_items SET position = rowid WHERE position = 0");
      this.conn.exec("PRAGMA user_version = 10");
    }
    if (version < 11) {
      this.conn.exec(`CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        cfi_range TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, cfi_range)
      )`);
      this.conn.exec("CREATE INDEX IF NOT EXISTS idx_annotations_item ON annotations(item_id, created_at DESC)");
      this.conn.exec("PRAGMA user_version = 11");
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
      const result = this.conn.prepare("DELETE FROM items WHERE id = ?").run(
        id,
      );
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
    for (const field of ["publisher", "language", "doi", "isbn", "arxiv_id"] as const) {
      if (u[field] !== undefined) {
        sets.push(`${field} = ?`);
        args.push(u[field] ?? null);
      }
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
          row.locked_fields.split(",").map((field) => field.trim()).filter(
            Boolean,
          ),
        );
        for (const field of fields) locked.add(field);
        this.conn.prepare(
          "UPDATE items SET locked_fields = ?, title_source = CASE WHEN ? THEN 'manual' ELSE title_source END WHERE id = ?",
        ).run(
          [...locked].sort().join(","),
          fields.includes("title") ? 1 : 0,
          id,
        );
        this.recordMetadataEvidence(
          id,
          fields.map((field) => ({
            field,
            value: String(u[field as keyof ItemUpdate] ?? ""),
            source: "manual" as const,
            confidence: 1,
            extractor_version: "manual-v1",
          })),
        );
      }
      return Ok(undefined);
    } catch (e) {
      return Err(DatabaseError(query, e));
    }
  }

  bulkUpdateItems(
    ids: number[],
    updates: ItemUpdate,
  ): Result<
    { batch_id: string; updated: number },
    AppError<"VALIDATION" | "DATABASE">
  > {
    const fields = Object.keys(updates).filter((field) => field !== "path");
    if (ids.length === 0 || fields.length === 0) {
      return Err(Validation("bulk update", "ids and updates are required"));
    }
    const allowed = new Set([
      "title",
      "authors",
      "year",
      "category",
      "tags",
      "purpose",
      "description",
    ]);
    if (fields.some((field) => !allowed.has(field))) {
      return Err(Validation("bulk update", "unsupported field"));
    }
    const batchId = crypto.randomUUID();
    let updated = 0;
    try {
      this.conn.exec("BEGIN");
      for (const id of [...new Set(ids)]) {
        const before = this.conn.prepare(
          "SELECT * FROM items WHERE id = ? AND ignored = 0",
        ).get(id) as Record<string, unknown> | undefined;
        if (!before) continue;
        const result = this.updateItem(id, updates);
        if (!result.ok) throw new Error(result.error.message);
        const after = this.conn.prepare("SELECT * FROM items WHERE id = ?").get(
          id,
        ) as Record<string, unknown>;
        for (const field of fields) {
          this.conn.prepare(
            "INSERT INTO edits (batch_id, item_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
          ).run(
            batchId,
            id,
            field,
            before[field] as string | number | null,
            after[field] as string | number | null,
          );
        }
        updated++;
      }
      this.conn.exec("COMMIT");
      return Ok({ batch_id: batchId, updated });
    } catch (e) {
      try {
        this.conn.exec("ROLLBACK");
      } catch { /* preserve original error */ }
      return Err(DatabaseError("bulk update", e));
    }
  }

  undoEdits(
    batchId: string,
  ): Result<{ undone: number }, AppError<"NOT_FOUND" | "DATABASE">> {
    const edits = this.conn.prepare(
      "SELECT item_id, field, old_value FROM edits WHERE batch_id = ? ORDER BY id DESC",
    ).all(batchId) as {
      item_id: number;
      field: string;
      old_value: string | number | null;
    }[];
    if (edits.length === 0) return Err(NotFound("Edit batch", batchId));
    const allowed = new Set([
      "title",
      "authors",
      "year",
      "category",
      "tags",
      "purpose",
      "description",
    ]);
    try {
      this.conn.exec("BEGIN");
      for (const edit of edits) {
        if (!allowed.has(edit.field)) {
          throw new Error(`unsupported edit field: ${edit.field}`);
        }
        this.conn.prepare(
          `UPDATE items SET ${edit.field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
          .run(edit.old_value, edit.item_id);
      }
      this.conn.exec("COMMIT");
      return Ok({ undone: new Set(edits.map((edit) => edit.item_id)).size });
    } catch (e) {
      try {
        this.conn.exec("ROLLBACK");
      } catch { /* preserve original error */ }
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
        "SELECT * FROM items ORDER BY added_at DESC LIMIT 10",
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
      const values = q.types?.length ? q.types : q.type ? [q.type] : [];
      const categories = q.categories?.length
        ? q.categories
        : q.category
        ? [q.category]
        : [];
      const tags = q.tags?.length ? q.tags : q.tag ? [q.tag] : [];
      const purposes = q.purposes?.length
        ? q.purposes
        : q.purpose
        ? [q.purpose]
        : [];
      const ftsQuery = q.q ? toFTSQuery(q.q) : "";
      const buildFilters = (
        exclude = "",
      ): { clauses: string[]; args: (string | number)[] } => {
        const clauses: string[] = ["i.ignored = 0"];
        const args: (string | number)[] = [];
        if (q.q) {
          const like = `%${q.q}%`;
          if (this._fts && ftsQuery) {
            clauses.push(
              "i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)",
            );
            args.push(ftsQuery);
          } else {
            clauses.push(
              "(i.title LIKE ? OR i.authors LIKE ? OR i.filename LIKE ? OR i.description LIKE ? OR i.purpose LIKE ?)",
            );
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
          clauses.push(
            `i.id IN (SELECT item_id FROM item_tags WHERE tag IN (${
              tags.map(() => "?").join(",")
            }))`,
          );
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

      const relevance = Boolean(q.q && this._fts && ftsQuery && !q.sort);
      const sort = relevance
        ? "relevance"
        : ["year", "added", "size"].includes(q.sort)
        ? q.sort
        : "title";
      const order: "asc" | "desc" = q.order === "asc" ? "asc" : "desc";
      const effectiveOrder = sort === "title" && !q.order ? "asc" : order;
      const sortField = sort === "relevance"
        ? "search_rank"
        : sort === "year"
        ? "i.year"
        : sort === "added"
        ? "i.added_at"
        : sort === "size"
        ? "i.size"
        : "i.title";
      const sortDirection = sort === "relevance"
        ? "ASC"
        : effectiveOrder.toUpperCase();
      const cursor = !relevance && q.cursor ? decodeCursor(q.cursor) : null;
      const queryFilters = buildFilters();
      if (cursor && cursor.sort === sort && cursor.order === effectiveOrder) {
        const comparison = effectiveOrder === "asc" ? ">" : "<";
        queryFilters.clauses.push(
          `(${sortField} ${comparison} ? OR (${sortField} = ? AND i.id > ?))`,
        );
        queryFilters.args.push(cursor.value, cursor.value, cursor.id);
      }
      const whereClause = `WHERE ${queryFilters.clauses.join(" AND ")}`;
      const orderClause = `ORDER BY ${sortField} ${sortDirection}, i.id ASC`;
      const offset = cursor ? 0 : (q.page - 1) * q.limit;
      const ranked = Boolean(q.q && this._fts && ftsQuery);
      const rankJoin = ranked
        ? `JOIN (
            SELECT rowid,
              bm25(items_fts, 12.0, 8.0, 2.0, 1.0, 3.0, 20.0, 20.0, 20.0, 2.0, 2.0) AS base_rank,
              snippet(items_fts, -1, '<mark>', '</mark>', ' … ', 18) AS match_snippet
            FROM items_fts WHERE items_fts MATCH ?
          ) matches ON matches.rowid = i.id`
        : "";
      const rankSelect = ranked
        ? `, CASE
              WHEN lower(i.doi) = lower(?) OR lower(i.isbn) = lower(?) OR lower(i.arxiv_id) = lower(?) THEN matches.base_rank - 1000
              WHEN lower(i.title) = lower(?) THEN matches.base_rank - 500
              ELSE matches.base_rank
            END AS search_rank, matches.match_snippet`
        : ", NULL AS search_rank, NULL AS match_snippet";
      const rankParams: (string | number)[] = ranked
        ? [q.q, q.q, q.q, q.q, ftsQuery]
        : [];
      const queryParams = [
        ...rankParams,
        ...queryFilters.args,
        q.limit,
        offset,
      ];
      const rows = this.conn.prepare(
        `SELECT i.*, rp.status AS progress_status, rp.progress_percent AS progress_percent_value,
          rp.current_page AS progress_current_page, rp.total_pages AS progress_total_pages,
          rp.started_at AS progress_started_at, rp.finished_at AS progress_finished_at,
          rp.last_read_at AS progress_last_read_at, rp.updated_at AS progress_updated_at
          ${rankSelect}
         FROM items i ${rankJoin} LEFT JOIN reading_progress rp ON rp.item_id = i.id
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
          search_rank: _rank,
          match_snippet,
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
        return {
          ...item,
          progress,
          match_snippet: match_snippet as string | null,
        } as SearchItem;
      });

      const totalPages = Math.ceil(total / q.limit);
      const last = items.at(-1);
      const nextCursor = !relevance && rows.length === q.limit && last
        ? encodeCursor({
          sort,
          order: effectiveOrder,
          value: last[
            sort === "year"
              ? "year"
              : sort === "added"
              ? "added_at"
              : sort === "size"
              ? "size"
              : "title"
          ] as string | number,
          id: last.id,
        })
        : null;

      const facet = (
        field: "type" | "category" | "purpose" | "tag",
      ): TagCount[] => {
        const facetFilters = buildFilters(field);
        const select = field === "tag" ? "it.tag" : `i.${field}`;
        const from = field === "tag"
          ? "FROM items i JOIN item_tags it ON it.item_id = i.id LEFT JOIN reading_progress rp ON rp.item_id = i.id"
          : "FROM items i LEFT JOIN reading_progress rp ON rp.item_id = i.id";
        return this.conn.prepare(
          `SELECT ${select} AS name, COUNT(DISTINCT i.id) AS count ${from} WHERE ${
            facetFilters.clauses.join(" AND ")
          } AND ${select} != '' GROUP BY ${select} ORDER BY count DESC, name ASC`,
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
    const rows = this.conn.prepare("SELECT path FROM items WHERE ignored = 0")
      .all() as {
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
          INSERT INTO items (title, authors, year, path, filename, type, category, tags, purpose, description,
            publisher, language, doi, isbn, arxiv_id, content_hash, size, title_source, added_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          item.title,
          item.authors,
          item.year,
          item.path,
          item.filename,
          item.type,
          item.category,
          item.tags,
          item.purpose,
          item.description,
          item.publisher ?? "",
          item.language ?? "",
          item.doi ?? "",
          item.isbn ?? "",
          item.arxiv_id ?? "",
          item.content_hash ?? "",
          item.size,
          item.title_source ?? "metadata",
        );
        const row = this.conn.prepare("SELECT last_insert_rowid() AS id")
          .get() as { id: number };
        this.recordMetadataEvidence(row.id, item.metadata_evidence ?? []);
        return;
      }

      const locked = new Set(
        (existing.locked_fields ?? "").split(",").map((field) => field.trim())
          .filter(Boolean),
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
          category = ?, tags = ?, purpose = ?, description = ?, publisher = ?,
          language = ?, doi = ?, isbn = ?, arxiv_id = ?, content_hash = ?, size = ?,
          missing_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        value("title", item.title),
        value("authors", item.authors),
        value("year", item.year),
        item.filename,
        item.type,
        value("category", item.category),
        value("tags", item.tags),
        value("purpose", item.purpose),
        value("description", item.description),
        value("publisher", item.publisher ?? ""),
        value("language", item.language ?? ""),
        value("doi", item.doi ?? ""),
        value("isbn", item.isbn ?? ""),
        value("arxiv_id", item.arxiv_id ?? ""),
        item.content_hash ?? existing.content_hash ?? "",
        item.size,
        existing.id,
      );
      if (!locked.has("title")) {
        this.conn.prepare("UPDATE items SET title_source = ? WHERE id = ?")
          .run(
            item.title_source ?? existing.title_source ?? "metadata",
            existing.id,
          );
      }
      this.recordMetadataEvidence(existing.id, item.metadata_evidence ?? []);
    });
  }

  recordMetadataEvidence(itemID: number, evidence: MetadataEvidence[]): void {
    const insert = this.conn.prepare(`
      INSERT INTO metadata_evidence
        (item_id, field, value, source, confidence, extractor_version, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(item_id, field, value, source, extractor_version)
      DO UPDATE SET confidence = excluded.confidence, observed_at = CURRENT_TIMESTAMP
    `);
    for (const candidate of evidence) {
      if (!candidate.value.trim()) continue;
      insert.run(
        itemID,
        candidate.field,
        candidate.value,
        candidate.source,
        Math.max(0, Math.min(1, candidate.confidence)),
        candidate.extractor_version,
      );
    }
  }

  getMetadataEvidence(itemID: number): MetadataEvidence[] {
    return this.conn.prepare(`
      SELECT field, value, source, confidence, extractor_version
      FROM metadata_evidence
      WHERE item_id = ?
      ORDER BY field, confidence DESC, observed_at DESC
    `).all(itemID) as unknown as MetadataEvidence[];
  }

  saveMetadataSuggestions(
    itemID: number,
    suggestions: Array<Omit<MetadataSuggestion, "id" | "item_id" | "status" | "created_at" | "resolved_at">>,
  ): Result<number, AppError<"NOT_FOUND" | "DATABASE">> {
    const item = this.getItem(itemID);
    if (!item.ok) return item;
    try {
      const insert = this.conn.prepare(`
        INSERT INTO metadata_suggestions
          (item_id, field, value, source, confidence, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, field, value, source) DO UPDATE SET
          confidence = excluded.confidence, details_json = excluded.details_json,
          status = 'pending', resolved_at = NULL
      `);
      let saved = 0;
      for (const suggestion of suggestions) {
        if (!suggestion.value.trim()) continue;
        insert.run(
          itemID, suggestion.field, suggestion.value, suggestion.source,
          Math.max(0, Math.min(1, suggestion.confidence)), suggestion.details_json,
        );
        saved++;
      }
      return Ok(saved);
    } catch (e) {
      return Err(DatabaseError("save metadata suggestions", e));
    }
  }

  getMetadataSuggestions(itemID: number): MetadataSuggestion[] {
    return this.conn.prepare(`
      SELECT * FROM metadata_suggestions
      WHERE item_id = ? AND status = 'pending'
      ORDER BY confidence DESC, created_at DESC, id DESC
    `).all(itemID) as unknown as MetadataSuggestion[];
  }

  resolveMetadataSuggestion(
    suggestionID: number,
    apply: boolean,
  ): Result<Item | null, AppError<"NOT_FOUND" | "DATABASE">> {
    const allowed = new Set([
      "title", "authors", "year", "publisher", "language", "doi", "isbn", "description",
    ]);
    try {
      const suggestion = this.conn.prepare(
        "SELECT * FROM metadata_suggestions WHERE id = ? AND status = 'pending'",
      ).get(suggestionID) as MetadataSuggestion | undefined;
      if (!suggestion) return Err(NotFound("Metadata suggestion", suggestionID));
      this.conn.exec("BEGIN");
      if (apply && allowed.has(suggestion.field)) {
        const value = suggestion.field === "year" ? Number(suggestion.value) : suggestion.value;
        this.conn.prepare(
          `UPDATE items SET ${suggestion.field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(value, suggestion.item_id);
        const lock = this.conn.prepare("SELECT locked_fields FROM items WHERE id = ?")
          .get(suggestion.item_id) as { locked_fields: string };
        const fields = new Set(lock.locked_fields.split(",").filter(Boolean));
        fields.add(suggestion.field);
        this.conn.prepare("UPDATE items SET locked_fields = ? WHERE id = ?")
          .run([...fields].sort().join(","), suggestion.item_id);
        this.recordMetadataEvidence(suggestion.item_id, [{
          field: suggestion.field, value: suggestion.value, source: suggestion.source,
          confidence: suggestion.confidence, extractor_version: "enrichment-v1",
        }]);
      }
      this.conn.prepare(
        "UPDATE metadata_suggestions SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(apply ? "applied" : "rejected", suggestionID);
      this.conn.exec("COMMIT");
      return apply ? this.getItem(suggestion.item_id) : Ok(null);
    } catch (e) {
      try { this.conn.exec("ROLLBACK"); } catch { /* transaction already ended */ }
      return Err(DatabaseError("resolve metadata suggestion", e));
    }
  }

  replaceDocumentContent(
    itemID: number,
    contentHash: string,
    status: ContentIndexState["status"],
    chunks: DocumentChunk[],
    error = "",
  ): Result<void, AppError<"NOT_FOUND" | "DATABASE">> {
    const item = this.getItem(itemID);
    if (!item.ok) return item;
    try {
      this.conn.exec("BEGIN");
      this.conn.prepare("DELETE FROM document_chunks_fts WHERE item_id = ?")
        .run(itemID);
      const insert = this.conn.prepare(
        "INSERT INTO document_chunks_fts (item_id, location, heading, content) VALUES (?, ?, ?, ?)",
      );
      for (const chunk of chunks) {
        insert.run(itemID, chunk.location, chunk.heading, chunk.content);
      }
      this.conn.prepare(`
        INSERT INTO document_index_state
          (item_id, content_hash, status, chunk_count, indexed_at, error)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          content_hash = excluded.content_hash,
          status = excluded.status,
          chunk_count = excluded.chunk_count,
          indexed_at = CURRENT_TIMESTAMP,
          error = excluded.error
      `).run(itemID, contentHash, status, chunks.length, error);
      this.conn.exec("COMMIT");
      return Ok(undefined);
    } catch (e) {
      try {
        this.conn.exec("ROLLBACK");
      } catch { /* no transaction to roll back */ }
      return Err(DatabaseError("replace document content", e));
    }
  }

  getContentIndexState(itemID: number): ContentIndexState | null {
    return this.conn.prepare(
      "SELECT * FROM document_index_state WHERE item_id = ?",
    ).get(itemID) as ContentIndexState | undefined ?? null;
  }

  getContentIndexStats(): ContentIndexStats {
    const rows = this.conn.prepare(
      "SELECT status, COUNT(*) AS count FROM document_index_state GROUP BY status",
    ).all() as Array<{ status: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.status, row.count]));
    const total = (this.conn.prepare(
      "SELECT COUNT(*) AS count FROM items WHERE ignored = 0",
    ).get() as { count: number }).count;
    const indexed = counts.get("indexed") ?? 0;
    const truncated = counts.get("truncated") ?? 0;
    const needsOcr = counts.get("needs_ocr") ?? 0;
    const failed = counts.get("failed") ?? 0;
    const unavailable = counts.get("unavailable") ?? 0;
    return {
      indexed,
      truncated,
      needs_ocr: needsOcr,
      failed,
      unavailable,
      pending: Math.max(0, total - indexed - truncated - needsOcr - failed - unavailable),
      total,
    };
  }

  getPendingMetadataSuggestions(): PendingMetadataSuggestion[] {
    const rows = this.conn.prepare(`
      SELECT ms.id AS suggestion_id, ms.item_id AS suggestion_item_id,
        ms.field AS suggestion_field, ms.value AS suggestion_value,
        ms.source AS suggestion_source, ms.confidence AS suggestion_confidence,
        ms.details_json AS suggestion_details_json, ms.status AS suggestion_status,
        ms.created_at AS suggestion_created_at, i.*
      FROM metadata_suggestions ms
      JOIN items i ON i.id = ms.item_id
      WHERE ms.status = 'pending' AND i.ignored = 0
      ORDER BY ms.confidence DESC, ms.created_at ASC, ms.id ASC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.suggestion_id),
      item_id: Number(row.suggestion_item_id),
      field: String(row.suggestion_field) as MetadataSuggestion["field"],
      value: String(row.suggestion_value),
      source: row.suggestion_source as MetadataSuggestion["source"],
      confidence: Number(row.suggestion_confidence),
      details_json: String(row.suggestion_details_json),
      status: row.suggestion_status as MetadataSuggestion["status"],
      created_at: String(row.suggestion_created_at),
      resolved_at: null,
      item: {
        ...row,
        id: Number(row.id),
      } as unknown as Item,
    }));
  }

  searchDocumentContent(
    query: string,
    limit = 8,
  ): Result<ContentSearchResult[], AppError<"DATABASE">> {
    const ftsQuery = toFTSQuery(query);
    if (!ftsQuery) return Ok([]);
    try {
      const rows = this.conn.prepare(`
        SELECT i.*, rp.item_id AS progress_item_id, rp.status AS progress_status,
          rp.progress_percent, rp.current_page, rp.total_pages, rp.started_at,
          rp.finished_at, rp.last_read_at, rp.updated_at AS progress_updated_at,
          chunks.location, chunks.heading,
          snippet(document_chunks_fts, 3, '<mark>', '</mark>', ' … ', 24) AS snippet
        FROM document_chunks_fts AS chunks
        JOIN items i ON i.id = chunks.item_id
        LEFT JOIN reading_progress rp ON rp.item_id = i.id
        WHERE document_chunks_fts MATCH ? AND i.ignored = 0
        ORDER BY bm25(document_chunks_fts, 0, 0, 2, 1)
        LIMIT ?
      `).all(ftsQuery, Math.max(1, Math.min(limit, 30))) as unknown as Array<
        Item & { location: string; heading: string; snippet: string }
      >;
      return Ok(rows.map((row) => ({
        item: row as unknown as SearchItem,
        location: row.location,
        heading: row.heading,
        snippet: row.snippet,
      })));
    } catch (e) {
      return Err(DatabaseError("search document content", e));
    }
  }

  getRelatedCopies(
    itemID: number,
  ): Result<Item[], AppError<"NOT_FOUND" | "DATABASE">> {
    const item = this.getItem(itemID);
    if (!item.ok) return item;
    try {
      const value = item.value;
      const rows = this.conn.prepare(`
        SELECT * FROM items
        WHERE id != ? AND ignored = 0 AND (
          (? != '' AND content_hash = ?) OR
          (? != '' AND doi = ?) OR
          (? != '' AND isbn = ?) OR
          (? != '' AND arxiv_id = ?)
        )
        ORDER BY CASE WHEN content_hash = ? AND ? != '' THEN 0 ELSE 1 END, title, id
      `).all(
        itemID,
        value.content_hash ?? "",
        value.content_hash ?? "",
        value.doi ?? "",
        value.doi ?? "",
        value.isbn ?? "",
        value.isbn ?? "",
        value.arxiv_id ?? "",
        value.arxiv_id ?? "",
        value.content_hash ?? "",
        value.content_hash ?? "",
      ) as unknown as Item[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("related copies", e));
    }
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

  recordReadingProgress(
    itemID: number,
    update: ReadingProgressUpdate,
  ): ReadingProgress {
    const existing = this.getReadingProgress(itemID);
    const now = new Date().toISOString();
    const furthest = Math.max(
      existing?.progress_percent ?? 0,
      update.progress_percent,
    );
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
    this.conn.prepare("DELETE FROM reading_queue WHERE item_id = ?").run(
      itemID,
    );
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
    this.conn.prepare(
      "UPDATE reading_progress SET status = 'reading', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'queued'",
    ).run(itemID);
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

  addBookmark(
    itemID: number,
    location: string,
    label: string,
    percent: number,
  ): Bookmark {
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

  getAnnotations(itemID: number): Annotation[] {
    return this.conn.prepare("SELECT * FROM annotations WHERE item_id = ? ORDER BY created_at DESC, id DESC").all(itemID) as unknown as Annotation[];
  }

  addAnnotation(itemID: number, cfiRange: string, text: string, note: string): Annotation {
    this.conn.prepare(`INSERT INTO annotations (item_id, cfi_range, text, note) VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id, cfi_range) DO UPDATE SET text = excluded.text, note = excluded.note`).run(itemID, cfiRange, text, note);
    return this.conn.prepare("SELECT * FROM annotations WHERE item_id = ? AND cfi_range = ?").get(itemID, cfiRange) as unknown as Annotation;
  }

  removeAnnotation(itemID: number, cfiRange: string): boolean {
    return Number(this.conn.prepare("DELETE FROM annotations WHERE item_id = ? AND cfi_range = ?").run(itemID, cfiRange).changes) > 0;
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

  private markItemQueued(itemID: number): void {
    const progress = this.getReadingProgress(itemID);
    if (!progress) {
      this.conn.prepare(`
        INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, updated_at)
        VALUES (?, 'queued', 0, 0, 0, CURRENT_TIMESTAMP)
      `).run(itemID);
    } else if (progress.status === "unread") {
      this.conn.prepare(
        "UPDATE reading_progress SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
      ).run(itemID);
    }
  }

  getReadingQueue(): ReadingQueueItem[] {
    return this.conn.prepare(
      "SELECT q.*, i.path as file_path, i.filename, i.type as file_type FROM reading_queue q LEFT JOIN items i ON q.item_id = i.id ORDER BY q.priority",
    ).all() as unknown as ReadingQueueItem[];
  }

  addToReadingQueue(item: QueueItemInput): void {
    if (item.item_id !== null && item.item_id !== undefined) {
      const existing = this.conn.prepare(
        "SELECT id FROM reading_queue WHERE item_id = ? LIMIT 1",
      ).get(item.item_id) as { id: number } | undefined;
      if (existing) {
        item.id = existing.id;
        this.markItemQueued(item.item_id);
        return;
      }
    }
    if (item.priority === undefined || item.priority === 0) {
      const next = this.conn.prepare(
        "SELECT COALESCE(MAX(priority) + 1, 0) as priority FROM reading_queue",
      ).get() as { priority: number };
      item.priority = next.priority;
    }
    this.conn.prepare(`
      INSERT INTO reading_queue (item_id, focusd_book_number, title, author, priority) VALUES (?, ?, ?, ?, ?)
    `).run(
      item.item_id ?? null,
      item.focusd_book_number ?? null,
      item.title,
      item.author,
      item.priority ?? 0,
    );
    if (item.item_id !== null && item.item_id !== undefined) {
      this.markItemQueued(item.item_id);
    }
  }

  removeFromReadingQueue(id: number): void {
    const queued = this.conn.prepare(
      "SELECT item_id FROM reading_queue WHERE id = ?",
    ).get(id) as { item_id: number | null } | undefined;
    this.conn.prepare("DELETE FROM reading_queue WHERE id = ?").run(id);
    if (queued?.item_id !== null && queued?.item_id !== undefined) {
      this.conn.prepare(
        "UPDATE reading_progress SET status = 'unread', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'queued'",
      ).run(queued.item_id);
    }
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

  finishReading(itemID: number): number | null {
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
    const next = this.conn.prepare(`
      SELECT item_id FROM reading_queue
      WHERE item_id IS NOT NULL
      ORDER BY priority, id
      LIMIT 1
    `).get() as { item_id: number } | undefined;
    return next?.item_id ?? null;
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

  get collections(): Result<Collection[], AppError<"DATABASE">> {
    try {
      const rows = this.conn.prepare(`
        SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
               COUNT(ci.item_id) AS item_count
        FROM collections c
        LEFT JOIN collection_items ci ON ci.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE
      `).all() as unknown as Collection[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("list collections", e));
    }
  }

  createCollection(
    name: string,
    description = "",
  ): Result<
    Collection,
    AppError<"DATABASE" | "VALIDATION" | "NOT_FOUND">
  > {
    const trimmed = name.trim();
    if (!trimmed) {
      return Err(Validation("name", "is required"));
    }
    try {
      const existing = this.conn.prepare(
        "SELECT id FROM collections WHERE name = ? COLLATE NOCASE",
      ).get(trimmed);
      if (existing) {
        return Err(
          AlreadyExists("Collection", trimmed) as AppError<"VALIDATION">,
        );
      }
      this.conn.prepare(
        "INSERT INTO collections (name, description) VALUES (?, ?)",
      ).run(trimmed, description.trim());
      const created = this.conn.prepare(
        "SELECT last_insert_rowid() AS id",
      ).get() as { id: number };
      return this.collection(created.id);
    } catch (e) {
      return Err(DatabaseError("INSERT INTO collections", e));
    }
  }

  deleteCollection(id: number): Result<boolean, AppError<"DATABASE">> {
    try {
      const result = this.conn.prepare(
        "DELETE FROM collections WHERE id = ?",
      ).run(id);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("DELETE FROM collections", e));
    }
  }

  updateCollection(
    id: number,
    name: string,
    description: string,
  ): Result<Collection, AppError<"DATABASE" | "VALIDATION" | "NOT_FOUND">> {
    const trimmedName = name.trim();
    if (!trimmedName) return Err(Validation("name", "is required"));
    const exists = this.collection(id);
    if (!exists.ok) return exists;
    try {
      const duplicate = this.conn.prepare(
        "SELECT id FROM collections WHERE name = ? COLLATE NOCASE AND id != ?",
      ).get(trimmedName, id);
      if (duplicate) return Err(AlreadyExists("Collection", trimmedName) as AppError<"VALIDATION">);
      this.conn.prepare(
        "UPDATE collections SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(trimmedName, description.trim(), id);
      return this.collection(id);
    } catch (e) {
      return Err(DatabaseError("UPDATE collection", e));
    }
  }

  /**
   * Touches `updated_at` when membership changes so clients can show recency.
   */
  private touchCollection(id: number): void {
    this.conn.prepare(
      "UPDATE collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(id);
  }

  collection(
    id: number,
  ): Result<Collection, AppError<"NOT_FOUND" | "DATABASE">> {
    try {
      const row = this.conn.prepare(`
        SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
               COUNT(ci.item_id) AS item_count
        FROM collections c
        LEFT JOIN collection_items ci ON ci.collection_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
      `).get(id) as Collection | undefined;
      if (!row) return Err(NotFound("Collection", id));
      return Ok(row);
    } catch (e) {
      return Err(DatabaseError("SELECT collection", e));
    }
  }

  collectionItems(
    id: number,
  ): Result<Item[], AppError<"NOT_FOUND" | "DATABASE">> {
    const exists = this.collection(id);
    if (!exists.ok) return exists;
    try {
      const rows = this.conn.prepare(`
        SELECT i.* FROM items i
        JOIN collection_items ci ON ci.item_id = i.id
        WHERE ci.collection_id = ?
        ORDER BY ci.position ASC, ci.added_at DESC, i.id DESC
      `).all(id) as unknown as Item[];
      return Ok(rows);
    } catch (e) {
      return Err(DatabaseError("SELECT collection items", e));
    }
  }

  addItemToCollection(
    collectionId: number,
    itemId: number,
  ): Result<boolean, AppError<"NOT_FOUND" | "DATABASE">> {
    const exists = this.collection(collectionId);
    if (!exists.ok) return exists;
    const item = this.getItem(itemId);
    if (!item.ok) return item;
    try {
      this.conn.prepare(
        "INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?, ?, COALESCE((SELECT MAX(position) + 1 FROM collection_items WHERE collection_id = ?), 0))",
      ).run(collectionId, itemId, collectionId);
      this.touchCollection(collectionId);
      return Ok(true);
    } catch (e) {
      return Err(DatabaseError("INSERT INTO collection_items", e));
    }
  }

  removeItemFromCollection(
    collectionId: number,
    itemId: number,
  ): Result<boolean, AppError<"NOT_FOUND" | "DATABASE">> {
    const exists = this.collection(collectionId);
    if (!exists.ok) return exists;
    try {
      const result = this.conn.prepare(
        "DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?",
      ).run(collectionId, itemId);
      if (result.changes > 0) this.touchCollection(collectionId);
      return Ok(result.changes > 0);
    } catch (e) {
      return Err(DatabaseError("DELETE FROM collection_items", e));
    }
  }

  reorderCollectionItems(collectionId: number, itemIds: number[]): Result<boolean, AppError<"NOT_FOUND" | "DATABASE" | "VALIDATION">> {
    const exists = this.collection(collectionId);
    if (!exists.ok) return exists;
    const current = this.conn.prepare("SELECT item_id FROM collection_items WHERE collection_id = ?").all(collectionId) as { item_id: number }[];
    if (current.length !== itemIds.length || new Set(current.map((row) => row.item_id)).size !== new Set(itemIds).size || current.some((row) => !itemIds.includes(row.item_id))) {
      return Err(Validation("ids", "must contain every item in the collection exactly once"));
    }
    try {
      this.conn.exec("BEGIN");
      const update = this.conn.prepare("UPDATE collection_items SET position = ? WHERE collection_id = ? AND item_id = ?");
      itemIds.forEach((itemId, position) => update.run(position, collectionId, itemId));
      this.touchCollection(collectionId);
      this.conn.exec("COMMIT");
      return Ok(true);
    } catch (e) {
      try { this.conn.exec("ROLLBACK"); } catch {}
      return Err(DatabaseError("reorder collection", e));
    }
  }
}
