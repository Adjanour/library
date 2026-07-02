package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bernard/library/internal/models"
	_ "modernc.org/sqlite"
)

type DB struct {
	conn *sql.DB
	fts  bool
}

func New(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

func (db *DB) Close() error {
	return db.conn.Close()
}

func (db *DB) migrate() error {
	schema := `
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
		description TEXT DEFAULT '',
		size INTEGER DEFAULT 0,
		added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
	CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
	CREATE INDEX IF NOT EXISTS idx_items_year ON items(year);
	CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);
	`

	if _, err := db.conn.Exec(schema); err != nil {
		return err
	}

	_, ftsErr := db.conn.Exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
			title, authors, filename, description,
			content='items',
			content_rowid='id',
			tokenize='porter unicode61'
		);
	`)
	db.fts = ftsErr == nil

	if db.fts {
		var count int
		db.conn.QueryRow("SELECT COUNT(*) FROM items_fts").Scan(&count)
		if count == 0 {
			db.conn.Exec(`
				INSERT INTO items_fts(rowid, title, authors, filename, description)
				SELECT id, title, authors, filename, description FROM items
			`)
		}

		db.conn.Exec(`
			CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
				INSERT INTO items_fts(rowid, title, authors, filename, description)
				VALUES (new.id, new.title, new.authors, new.filename, new.description);
			END;
		`)
		db.conn.Exec(`
			CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
				INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description)
				VALUES('delete', old.id, old.title, old.authors, old.filename, old.description);
			END;
		`)
		db.conn.Exec(`
			CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
				INSERT INTO items_fts(items_fts, rowid, title, authors, filename, description)
				VALUES('delete', old.id, old.title, old.authors, old.filename, old.description);
				INSERT INTO items_fts(rowid, title, authors, filename, description)
				VALUES (new.id, new.title, new.authors, new.filename, new.description);
			END;
		`)
	}

	_, descErr := db.conn.Exec(`
		ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''
	`)
	if descErr != nil && !strings.Contains(descErr.Error(), "duplicate column") {
		return nil
	}

	// purpose column (e.g. learning, reference, research, interview-prep, ...)
	_, purposeErr := db.conn.Exec(`
		ALTER TABLE items ADD COLUMN purpose TEXT DEFAULT ''
	`)
	if purposeErr != nil && !strings.Contains(purposeErr.Error(), "duplicate column") {
		return nil
	}

	// Tags junction table
	_, tagsErr := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS item_tags (
			item_id INTEGER NOT NULL,
			tag TEXT NOT NULL,
			PRIMARY KEY (item_id, tag),
			FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
		);
	`)
	if tagsErr != nil {
		return nil
	}

	// Migrate existing CSV tags to junction table
	var tagCount int
	db.conn.QueryRow("SELECT COUNT(*) FROM item_tags").Scan(&tagCount)
	if tagCount == 0 {
		rows, err := db.conn.Query("SELECT id, tags FROM items WHERE tags != ''")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int64
				var tags string
				rows.Scan(&id, &tags)
				for _, t := range strings.Split(tags, ",") {
					t = strings.TrimSpace(t)
					if t != "" {
						db.conn.Exec("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)", id, t)
					}
				}
			}
		}
	}

	// Reading progress tracking
	_, rpErr := db.conn.Exec(`
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
		);
	`)
	if rpErr != nil {
		return nil
	}

	// Reading sessions (time tracking)
	_, rsErr := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS reading_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
			started_at DATETIME NOT NULL,
			ended_at DATETIME,
			duration_seconds INTEGER DEFAULT 0,
			pages_read INTEGER DEFAULT 0
		);
	`)
	if rsErr != nil {
		return nil
	}
	db.conn.Exec("CREATE INDEX IF NOT EXISTS idx_sessions_item ON reading_sessions(item_id)")

	// Reading queue (synced from FocusD reading plan)
	_, rqErr := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS reading_queue (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
			focusd_book_number INTEGER,
			title TEXT NOT NULL,
			author TEXT DEFAULT '',
			priority INTEGER DEFAULT 0,
			added_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if rqErr != nil {
		return nil
	}

	return nil
}

func toFTSQuery(input string) string {
	parts := strings.Fields(input)
	if len(parts) == 0 {
		return ""
	}
	for i, p := range parts {
		p = strings.Trim(p, `"'*`)
		parts[i] = p + "*"
	}
	return strings.Join(parts, " AND ")
}

func (db *DB) UpsertItem(item *models.Item) error {
	query := `
	INSERT INTO items (title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	ON CONFLICT(path) DO UPDATE SET
		title = excluded.title,
		authors = excluded.authors,
		year = excluded.year,
		filename = excluded.filename,
		type = excluded.type,
		category = excluded.category,
		tags = excluded.tags,
		purpose = excluded.purpose,
		description = excluded.description,
		size = excluded.size,
		updated_at = CURRENT_TIMESTAMP
	`
	result, err := db.conn.Exec(query, item.Title, item.Authors, item.Year,
		item.Path, item.Filename, item.Type, item.Category, item.Tags, item.Purpose, item.Description, item.Size)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err == nil {
		item.ID = id
	}

	// Sync junction table
	db.syncItemTags(item.ID, item.Tags)

	return nil
}

func (db *DB) syncItemTags(itemID int64, tagsCSV string) {
	db.conn.Exec("DELETE FROM item_tags WHERE item_id = ?", itemID)
	if tagsCSV == "" {
		return
	}
	for _, t := range strings.Split(tagsCSV, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			db.conn.Exec("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)", itemID, t)
		}
	}
}

func (db *DB) GetItem(id int64) (*models.Item, error) {
	item := &models.Item{}
	err := db.conn.QueryRow(`SELECT id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at FROM items WHERE id = ?`, id).Scan(
		&item.ID, &item.Title, &item.Authors, &item.Year, &item.Path, &item.Filename,
		&item.Type, &item.Category, &item.Tags, &item.Purpose, &item.Description, &item.Size, &item.AddedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (db *DB) Search(q models.SearchQuery) (*models.SearchResult, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 20
	}

	where := []string{}
	args := []interface{}{}

	if q.Q != "" {
		like := "%" + q.Q + "%"
		if db.fts {
			where = append(where, "(id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?) OR purpose LIKE ?)")
			args = append(args, toFTSQuery(q.Q), like)
		} else {
			where = append(where, "(title LIKE ? OR authors LIKE ? OR filename LIKE ? OR description LIKE ? OR purpose LIKE ?)")
			args = append(args, like, like, like, like, like)
		}
	}
	if q.Type != "" {
		where = append(where, "type = ?")
		args = append(args, q.Type)
	}
	if q.Category != "" {
		where = append(where, "category = ?")
		args = append(args, q.Category)
	}
	if q.Tag != "" {
		where = append(where, "id IN (SELECT item_id FROM item_tags WHERE tag = ?)")
		args = append(args, q.Tag)
	}
	if q.Purpose != "" {
		where = append(where, "purpose = ?")
		args = append(args, q.Purpose)
	}
	if q.Year > 0 {
		where = append(where, "year = ?")
		args = append(args, q.Year)
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = "WHERE " + strings.Join(where, " AND ")
	}

	orderClause := "ORDER BY title ASC"
	switch q.Sort {
	case "year":
		orderClause = "ORDER BY year DESC"
	case "added":
		orderClause = "ORDER BY added_at DESC"
	case "size":
		orderClause = "ORDER BY size DESC"
	}
	if q.Order == "asc" && q.Sort != "" {
		orderClause = strings.Replace(orderClause, "DESC", "ASC", 1)
	}

	selectCols := "id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at"

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM items %s", whereClause)
	if err := db.conn.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	offset := (q.Page - 1) * q.Limit
	query := fmt.Sprintf("SELECT %s FROM items %s %s LIMIT ? OFFSET ?", selectCols, whereClause, orderClause)
	queryArgs := append(args, q.Limit, offset)

	rows, err := db.conn.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []models.Item{}
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(
			&item.ID, &item.Title, &item.Authors, &item.Year, &item.Path, &item.Filename,
			&item.Type, &item.Category, &item.Tags, &item.Purpose, &item.Description, &item.Size, &item.AddedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	totalPages := total / q.Limit
	if total%q.Limit > 0 {
		totalPages++
	}

	return &models.SearchResult{
		Items:      items,
		Total:      total,
		Page:       q.Page,
		Limit:      q.Limit,
		TotalPages: totalPages,
	}, nil
}

func (db *DB) GetStats() (*models.Stats, error) {
	stats := &models.Stats{
		ByType:     make(map[string]int),
		ByCategory: make(map[string]int),
		ByYear:     make(map[string]int),
	}

	db.conn.QueryRow("SELECT COUNT(*) FROM items").Scan(&stats.TotalItems)

	rows, err := db.conn.Query("SELECT type, COUNT(*) FROM items GROUP BY type")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		var c int
		rows.Scan(&t, &c)
		stats.ByType[t] = c
	}

	rows2, err := db.conn.Query("SELECT category, COUNT(*) FROM items WHERE category != '' GROUP BY category ORDER BY COUNT(*) DESC")
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var c string
		var n int
		rows2.Scan(&c, &n)
		stats.ByCategory[c] = n
	}

	rows3, err := db.conn.Query("SELECT CAST(year AS TEXT), COUNT(*) FROM items WHERE year > 0 GROUP BY year ORDER BY year DESC")
	if err != nil {
		return nil, err
	}
	defer rows3.Close()
	for rows3.Next() {
		var y string
		var n int
		rows3.Scan(&y, &n)
		stats.ByYear[y] = n
	}

	recentRows, err := db.conn.Query("SELECT id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at FROM items ORDER BY added_at DESC LIMIT 10")
	if err != nil {
		return nil, err
	}
	defer recentRows.Close()
	for recentRows.Next() {
		var item models.Item
		recentRows.Scan(
			&item.ID, &item.Title, &item.Authors, &item.Year, &item.Path, &item.Filename,
			&item.Type, &item.Category, &item.Tags, &item.Purpose, &item.Description, &item.Size, &item.AddedAt, &item.UpdatedAt,
		)
		stats.RecentAdded = append(stats.RecentAdded, item)
	}

	return stats, nil
}

func (db *DB) GetCategories() ([]models.Category, error) {
	rows, err := db.conn.Query("SELECT category, COUNT(*) FROM items WHERE category != '' GROUP BY category ORDER BY COUNT(*) DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []models.Category
	for rows.Next() {
		var c models.Category
		rows.Scan(&c.Name, &c.Count)
		cats = append(cats, c)
	}
	return cats, nil
}

func (db *DB) GetTags() ([]models.Tag, error) {
	rows, err := db.conn.Query("SELECT tag, COUNT(*) as cnt FROM item_tags GROUP BY tag ORDER BY cnt DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Tag
	for rows.Next() {
		var t models.Tag
		rows.Scan(&t.Name, &t.Count)
		result = append(result, t)
	}
	return result, nil
}

func (db *DB) GetPurposes() ([]models.Tag, error) {
	rows, err := db.conn.Query("SELECT purpose, COUNT(*) as cnt FROM items WHERE purpose != '' GROUP BY purpose ORDER BY cnt DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Tag
	for rows.Next() {
		var t models.Tag
		rows.Scan(&t.Name, &t.Count)
		result = append(result, t)
	}
	return result, nil
}

func (db *DB) DeleteItem(id int64) error {
	_, err := db.conn.Exec("DELETE FROM items WHERE id = ?", id)
	return err
}

// UpdateItem applies a partial update to an item's editable metadata.
// Only non-nil fields in u are applied. Tags are re-synced to the junction
// table and FTS is kept in sync by the existing AFTER UPDATE trigger.
func (db *DB) UpdateItem(id int64, u models.ItemUpdate) error {
	sets := []string{}
	args := []interface{}{}
	if u.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *u.Title)
	}
	if u.Authors != nil {
		sets = append(sets, "authors = ?")
		args = append(args, *u.Authors)
	}
	if u.Year != nil {
		sets = append(sets, "year = ?")
		args = append(args, *u.Year)
	}
	if u.Category != nil {
		sets = append(sets, "category = ?")
		args = append(args, *u.Category)
	}
	if u.Tags != nil {
		sets = append(sets, "tags = ?")
		args = append(args, *u.Tags)
	}
	if u.Purpose != nil {
		sets = append(sets, "purpose = ?")
		args = append(args, *u.Purpose)
	}
	if u.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *u.Description)
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	query := "UPDATE items SET " + strings.Join(sets, ", ") + " WHERE id = ?"
	if _, err := db.conn.Exec(query, args...); err != nil {
		return err
	}
	if u.Tags != nil {
		db.syncItemTags(id, *u.Tags)
	}
	return nil
}

// UpdateItemPath updates the on-disk path/filename after a file has been moved
// by the organize tool. The FTS AFTER UPDATE trigger keeps search in sync.
func (db *DB) UpdateItemPath(id int64, path, filename string) error {
	_, err := db.conn.Exec("UPDATE items SET path = ?, filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", path, filename, id)
	return err
}

func (db *DB) GetAllPaths() (map[string]bool, error) {
	rows, err := db.conn.Query("SELECT path FROM items")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	paths := make(map[string]bool)
	for rows.Next() {
		var p string
		rows.Scan(&p)
		paths[p] = true
	}
	return paths, nil
}

// --- Reading Progress ---

func (db *DB) GetReadingProgress(itemID int64) (*models.ReadingProgress, error) {
	p := &models.ReadingProgress{}
	err := db.conn.QueryRow(`
		SELECT item_id, status, progress_percent, current_page, total_pages,
		       started_at, finished_at, last_read_at, updated_at
		FROM reading_progress WHERE item_id = ?`, itemID).Scan(
		&p.ItemID, &p.Status, &p.ProgressPercent, &p.CurrentPage, &p.TotalPages,
		&p.StartedAt, &p.FinishedAt, &p.LastReadAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (db *DB) GetAllReadingProgress() ([]models.ReadingProgress, error) {
	rows, err := db.conn.Query(`
		SELECT item_id, status, progress_percent, current_page, total_pages,
		       started_at, finished_at, last_read_at, updated_at
		FROM reading_progress`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.ReadingProgress
	for rows.Next() {
		var p models.ReadingProgress
		rows.Scan(&p.ItemID, &p.Status, &p.ProgressPercent, &p.CurrentPage, &p.TotalPages,
			&p.StartedAt, &p.FinishedAt, &p.LastReadAt, &p.UpdatedAt)
		result = append(result, p)
	}
	return result, nil
}

func (db *DB) UpsertReadingProgress(p *models.ReadingProgress) error {
	_, err := db.conn.Exec(`
		INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages,
		                              started_at, finished_at, last_read_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(item_id) DO UPDATE SET
			status = excluded.status,
			progress_percent = excluded.progress_percent,
			current_page = excluded.current_page,
			total_pages = excluded.total_pages,
			started_at = excluded.started_at,
			finished_at = excluded.finished_at,
			last_read_at = excluded.last_read_at,
			updated_at = CURRENT_TIMESTAMP`,
		p.ItemID, p.Status, p.ProgressPercent, p.CurrentPage, p.TotalPages,
		p.StartedAt, p.FinishedAt, p.LastReadAt)
	return err
}

// --- Reading Sessions ---

func (db *DB) StartReadingSession(itemID int64) (*models.ReadingSession, error) {
	result, err := db.conn.Exec(`
		INSERT INTO reading_sessions (item_id, started_at) VALUES (?, CURRENT_TIMESTAMP)`, itemID)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	// Update reading_progress status
	db.conn.Exec(`
		INSERT INTO reading_progress (item_id, status, started_at, last_read_at, updated_at)
		VALUES (?, 'reading', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(item_id) DO UPDATE SET
			status = 'reading',
			last_read_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP`, itemID)

	return &models.ReadingSession{ID: id, ItemID: itemID}, nil
}

func (db *DB) StopReadingSession(sessionID int64, pagesRead int) error {
	_, err := db.conn.Exec(`
		UPDATE reading_sessions
		SET ended_at = CURRENT_TIMESTAMP,
		    duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER),
		    pages_read = ?
		WHERE id = ? AND ended_at IS NULL`, pagesRead, sessionID)
	return err
}

func (db *DB) GetReadingSessions(itemID int64, limit int) ([]models.ReadingSession, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := db.conn.Query(`
		SELECT id, item_id, started_at, ended_at, duration_seconds, pages_read
		FROM reading_sessions WHERE item_id = ?
		ORDER BY started_at DESC LIMIT ?`, itemID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.ReadingSession
	for rows.Next() {
		var s models.ReadingSession
		rows.Scan(&s.ID, &s.ItemID, &s.StartedAt, &s.EndedAt, &s.DurationSeconds, &s.PagesRead)
		result = append(result, s)
	}
	return result, nil
}

func (db *DB) GetActiveSession(itemID int64) (*models.ReadingSession, error) {
	s := &models.ReadingSession{}
	err := db.conn.QueryRow(`
		SELECT id, item_id, started_at, ended_at, duration_seconds, pages_read
		FROM reading_sessions WHERE item_id = ? AND ended_at IS NULL
		ORDER BY started_at DESC LIMIT 1`, itemID).Scan(
		&s.ID, &s.ItemID, &s.StartedAt, &s.EndedAt, &s.DurationSeconds, &s.PagesRead)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (db *DB) GetTotalReadingMinutes(itemID int64) (int, error) {
	var total int
	err := db.conn.QueryRow(`
		SELECT COALESCE(SUM(duration_seconds), 0) / 60
		FROM reading_sessions WHERE item_id = ? AND ended_at IS NOT NULL`, itemID).Scan(&total)
	return total, err
}

func (db *DB) GetTodayReadingMinutes() (int, error) {
	var total int
	err := db.conn.QueryRow(`
		SELECT COALESCE(SUM(duration_seconds), 0) / 60
		FROM reading_sessions
		WHERE ended_at IS NOT NULL AND date(started_at) = date('now')`).Scan(&total)
	return total, err
}

func (db *DB) GetWeekReadingMinutes() (int, error) {
	var total int
	err := db.conn.QueryRow(`
		SELECT COALESCE(SUM(duration_seconds), 0) / 60
		FROM reading_sessions
		WHERE ended_at IS NOT NULL AND started_at >= date('now', '-7 days')`).Scan(&total)
	return total, err
}

// --- Reading Queue ---

func (db *DB) GetReadingQueue() ([]models.ReadingQueueItem, error) {
	rows, err := db.conn.Query(`
		SELECT q.id, q.item_id, q.focusd_book_number, q.title, q.author, q.priority, q.added_at,
		       i.path, i.filename, i.type
		FROM reading_queue q
		LEFT JOIN items i ON q.item_id = i.id
		ORDER BY q.priority ASC, q.added_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.ReadingQueueItem
	for rows.Next() {
		var q models.ReadingQueueItem
		rows.Scan(&q.ID, &q.ItemID, &q.FocusdBookNumber, &q.Title, &q.Author, &q.Priority, &q.AddedAt,
			&q.FilePath, &q.Filename, &q.FileType)
		result = append(result, q)
	}
	return result, nil
}

func (db *DB) AddToReadingQueue(item *models.ReadingQueueItem) error {
	result, err := db.conn.Exec(`
		INSERT INTO reading_queue (item_id, focusd_book_number, title, author, priority)
		VALUES (?, ?, ?, ?, ?)`,
		item.ItemID, item.FocusdBookNumber, item.Title, item.Author, item.Priority)
	if err != nil {
		return err
	}
	id, _ := result.LastInsertId()
	item.ID = id
	return nil
}

func (db *DB) RemoveFromReadingQueue(id int64) error {
	_, err := db.conn.Exec("DELETE FROM reading_queue WHERE id = ?", id)
	return err
}

func (db *DB) ReorderReadingQueue(ids []int64) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("UPDATE reading_queue SET priority = ? WHERE id = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, id := range ids {
		stmt.Exec(i, id)
	}
	return tx.Commit()
}

// --- Dashboard ---

func (db *DB) GetReadingDashboard() (*models.ReadingDashboard, error) {
	d := &models.ReadingDashboard{}

	// Currently reading
	rows, err := db.conn.Query(`
		SELECT i.id, i.title, i.authors, i.year, i.path, i.filename, i.type, i.category, i.tags, i.description, i.size, i.added_at, i.updated_at,
		       rp.status, rp.progress_percent, rp.current_page, rp.total_pages, rp.started_at, rp.finished_at, rp.last_read_at, rp.updated_at
		FROM items i
		JOIN reading_progress rp ON i.id = rp.item_id
		WHERE rp.status = 'reading'
		ORDER BY rp.last_read_at DESC`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var item models.Item
			var p models.ReadingProgress
			rows.Scan(&item.ID, &item.Title, &item.Authors, &item.Year, &item.Path, &item.Filename,
				&item.Type, &item.Category, &item.Tags, &item.Description, &item.Size, &item.AddedAt, &item.UpdatedAt,
				&p.Status, &p.ProgressPercent, &p.CurrentPage, &p.TotalPages,
				&p.StartedAt, &p.FinishedAt, &p.LastReadAt, &p.UpdatedAt)
			p.ItemID = item.ID
			d.CurrentlyReading = append(d.CurrentlyReading, models.ReadingStatusItem{
				Item:     item,
				Progress: p,
			})
		}
	}

	// Queue
	d.Queue, _ = db.GetReadingQueue()

	// Stats
	db.conn.QueryRow("SELECT COUNT(*) FROM reading_progress WHERE status = 'finished'").Scan(&d.TotalReadBooks)
	d.TodayReadingMin, _ = db.GetTodayReadingMinutes()
	d.WeekReadingMin, _ = db.GetWeekReadingMinutes()

	return d, nil
}

// --- FocusD Sync ---

func (db *DB) SyncFocusdReadingPlan(books []models.ReadingQueueItem) (int, error) {
	// Clear existing FocusD-synced items
	db.conn.Exec("DELETE FROM reading_queue WHERE focusd_book_number IS NOT NULL")

	added := 0
	for _, book := range books {
		// Try to match by title to existing library items
		var itemID *int64

		// Strategy 1: Exact title match
		var row int64
		err := db.conn.QueryRow("SELECT id FROM items WHERE title = ? LIMIT 1", book.Title).Scan(&row)
		if err == nil {
			itemID = &row
		}

		// Strategy 2: Title contains the book name (fuzzy match)
		if itemID == nil {
			err = db.conn.QueryRow("SELECT id FROM items WHERE title LIKE ? LIMIT 1", "%"+book.Title+"%").Scan(&row)
			if err == nil {
				itemID = &row
			}
		}

		// Strategy 3: Normalize and match (handle apostrophes, etc.)
		if itemID == nil {
			normalized := strings.ReplaceAll(book.Title, "'", "'")
			normalized = strings.ReplaceAll(normalized, "'", "'")
			err = db.conn.QueryRow("SELECT id FROM items WHERE REPLACE(REPLACE(title, '''', ''''), '''', '''') LIKE ? LIMIT 1", "%"+normalized+"%").Scan(&row)
			if err == nil {
				itemID = &row
			}
		}

		// Strategy 4: Filename contains key words from title
		if itemID == nil {
			words := strings.Fields(book.Title)
			if len(words) > 0 {
				// Try first 2 significant words
				likeParts := make([]string, 0, 2)
				for _, w := range words {
					if len(w) > 3 { // Skip short words like "the", "is", "a"
						likeParts = append(likeParts, "filename LIKE '%"+w+"%'")
					}
					if len(likeParts) >= 2 {
						break
					}
				}
				if len(likeParts) > 0 {
					query := "SELECT id FROM items WHERE " + strings.Join(likeParts, " AND ") + " LIMIT 1"
					err = db.conn.QueryRow(query).Scan(&row)
					if err == nil {
						itemID = &row
					}
				}
			}
		}

		_, err = db.conn.Exec(`
			INSERT INTO reading_queue (item_id, focusd_book_number, title, author, priority)
			VALUES (?, ?, ?, ?, ?)`,
			itemID, book.FocusdBookNumber, book.Title, book.Author, book.Priority)
		if err == nil {
			added++
		}
	}
	return added, nil
}

func (db *DB) FinishReading(itemID int64) error {
	// Update progress
	_, err := db.conn.Exec(`
		UPDATE reading_progress
		SET status = 'finished', progress_percent = 100, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE item_id = ?`, itemID)
	if err != nil {
		return err
	}

	// Close any active session
	db.conn.Exec(`
		UPDATE reading_sessions
		SET ended_at = CURRENT_TIMESTAMP,
		    duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
		WHERE item_id = ? AND ended_at IS NULL`, itemID)

	// Remove from queue
	db.conn.Exec("DELETE FROM reading_queue WHERE item_id = ?", itemID)

	return nil
}

// Readest sync methods

// UpdateProgressFromReadest updates reading progress from Readest data
func (db *DB) UpdateProgressFromReadest(itemID int64, readestHash string, currentPage, totalPages int) error {
	status := "reading"
	if totalPages > 0 && currentPage >= totalPages {
		status = "finished"
	} else if currentPage == 0 {
		status = "unread"
	}

	progressPercent := 0
	if totalPages > 0 {
		progressPercent = (currentPage * 100) / totalPages
	}

	_, err := db.conn.Exec(`
		INSERT INTO reading_progress (item_id, status, progress_percent, current_page, total_pages, last_read_at, updated_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(item_id) DO UPDATE SET
			status = excluded.status,
			progress_percent = excluded.progress_percent,
			current_page = excluded.current_page,
			total_pages = excluded.total_pages,
			last_read_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP`, itemID, status, progressPercent, currentPage, totalPages)
	return err
}

// GetAllItems returns all items for matching
func (db *DB) GetAllItems() ([]models.Item, error) {
	rows, err := db.conn.Query("SELECT id, title, authors, year, path, filename, type, category, tags, purpose, description, size, added_at, updated_at FROM items")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.Item
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(&item.ID, &item.Title, &item.Authors, &item.Year, &item.Path, &item.Filename, &item.Type, &item.Category, &item.Tags, &item.Purpose, &item.Description, &item.Size, &item.AddedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// GetReadestSyncStatus returns sync status
func (db *DB) GetReadestSyncStatus() (*models.ReadestSyncStatus, error) {
	status := &models.ReadestSyncStatus{
		Enabled: true,
	}

	// Count books with Readest progress
	err := db.conn.QueryRow(`
		SELECT COUNT(*) FROM reading_progress 
		WHERE current_page > 0`).Scan(&status.CurrentlyReading)
	if err != nil {
		return nil, err
	}

	return status, nil
}

// GetReadingProgressByItemIDs returns progress for multiple items
func (db *DB) GetReadingProgressByItemIDs(itemIDs []int64) (map[int64]*models.ReadingProgress, error) {
	if len(itemIDs) == 0 {
		return make(map[int64]*models.ReadingProgress), nil
	}

	// Build IN clause
	placeholders := make([]string, len(itemIDs))
	args := make([]interface{}, len(itemIDs))
	for i, id := range itemIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT item_id, status, progress_percent, current_page, total_pages, 
		       started_at, finished_at, last_read_at, updated_at
		FROM reading_progress 
		WHERE item_id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int64]*models.ReadingProgress)
	for rows.Next() {
		var p models.ReadingProgress
		if err := rows.Scan(&p.ItemID, &p.Status, &p.ProgressPercent, &p.CurrentPage, &p.TotalPages,
			&p.StartedAt, &p.FinishedAt, &p.LastReadAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		result[p.ItemID] = &p
	}
	return result, nil
}
