package models

import "time"

type BookType string

const (
	TypeBook   BookType = "book"
	TypePaper  BookType = "paper"
	TypeThesis BookType = "thesis"
	TypeEbook  BookType = "ebook"
	TypeOther  BookType = "other"
)

type Item struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Authors     string    `json:"authors"`
	Year        int       `json:"year"`
	Path        string    `json:"path"`
	Filename    string    `json:"filename"`
	Type        BookType  `json:"type"`
	Category    string    `json:"category"`
	Tags        string    `json:"tags"`
	Description string    `json:"description"`
	Size        int64     `json:"size"`
	AddedAt     time.Time `json:"added_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SearchQuery struct {
	Q        string `form:"q"`
	Type     string `form:"type"`
	Category string `form:"category"`
	Tag      string `form:"tag"`
	Year     int    `form:"year"`
	Sort     string `form:"sort"`
	Order    string `form:"order"`
	Page     int    `form:"page"`
	Limit    int    `form:"limit"`
}

type SearchResult struct {
	Items      []Item `json:"items"`
	Total      int    `json:"total"`
	Page       int    `json:"page"`
	Limit      int    `json:"limit"`
	TotalPages int    `json:"total_pages"`
}

type Stats struct {
	TotalItems  int            `json:"total_items"`
	ByType      map[string]int `json:"by_type"`
	ByCategory  map[string]int `json:"by_category"`
	ByYear      map[string]int `json:"by_year"`
	RecentAdded []Item         `json:"recent_added"`
}

type Category struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type Tag struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Reading progress for a book
type ReadingProgress struct {
	ItemID           int64      `json:"item_id"`
	Status           string     `json:"status"` // unread, reading, finished, abandoned
	ProgressPercent  int        `json:"progress_percent"`
	CurrentPage      int        `json:"current_page"`
	TotalPages       int        `json:"total_pages"`
	StartedAt        *time.Time `json:"started_at"`
	FinishedAt       *time.Time `json:"finished_at"`
	LastReadAt       *time.Time `json:"last_read_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// A single reading session
type ReadingSession struct {
	ID              int64      `json:"id"`
	ItemID          int64      `json:"item_id"`
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at"`
	DurationSeconds int        `json:"duration_seconds"`
	PagesRead       int        `json:"pages_read"`
}

// Item in the reading queue
type ReadingQueueItem struct {
	ID                int64      `json:"id"`
	ItemID            *int64     `json:"item_id"`
	FocusdBookNumber  *int       `json:"focusd_book_number"`
	Title             string     `json:"title"`
	Author            string     `json:"author"`
	Priority          int        `json:"priority"`
	AddedAt           time.Time  `json:"added_at"`
	FilePath          *string    `json:"file_path,omitempty"`
	Filename          *string    `json:"filename,omitempty"`
	FileType          *string    `json:"file_type,omitempty"`
}

// Dashboard aggregation
type ReadingDashboard struct {
	CurrentlyReading  []ReadingStatusItem `json:"currently_reading"`
	Queue             []ReadingQueueItem  `json:"queue"`
	TotalReadBooks    int                 `json:"total_read_books"`
	TotalReadingMin   int                 `json:"total_reading_minutes"`
	TodayReadingMin   int                 `json:"today_reading_minutes"`
	WeekReadingMin    int                 `json:"week_reading_minutes"`
}

type ReadingStatusItem struct {
	Item            Item           `json:"item"`
	Progress        ReadingProgress `json:"progress"`
	TodayMinutes    int            `json:"today_minutes"`
	TotalMinutes    int            `json:"total_minutes"`
}

// ReadestSyncStatus represents the status of Readest sync
type ReadestSyncStatus struct {
	Enabled         bool       `json:"enabled"`
	LastSyncAt      *time.Time `json:"last_sync_at"`
	TotalBooks      int        `json:"total_books"`
	MatchedBooks    int        `json:"matched_books"`
	UnmatchedBooks  int        `json:"unmatched_books"`
	CurrentlyReading int       `json:"currently_reading"`
}

// ReadestSyncResult represents the result of a sync operation
type ReadestSyncResult struct {
	Success         bool       `json:"success"`
	Message         string     `json:"message"`
	SyncedAt        time.Time  `json:"synced_at"`
	TotalBooks      int        `json:"total_books"`
	MatchedBooks    int        `json:"matched_books"`
	UnmatchedBooks  int        `json:"unmatched_books"`
	UpdatedProgress int        `json:"updated_progress"`
	Books           []ReadestSyncedBook `json:"books,omitempty"`
}

// ReadestSyncedBook represents a book that was synced
type ReadestSyncedBook struct {
	Hash            string `json:"hash"`
	Title           string `json:"title"`
	LibraryItemID   int64  `json:"library_item_id"`
	CurrentPage     int    `json:"current_page"`
	TotalPages      int    `json:"total_pages"`
	ProgressPercent int    `json:"progress_percent"`
	MatchStrategy   string `json:"match_strategy"`
	Confidence      float64 `json:"confidence"`
}
