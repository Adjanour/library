package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/models"
	"github.com/bernard/library/internal/readest"
)

type ReadingHandler struct {
	db      *db.DB
	readest *readest.ReadestLibrary
	matcher *readest.Matcher
}

func NewReadingHandler(database *db.DB) *ReadingHandler {
	return &ReadingHandler{
		db:      database,
		readest: readest.NewReadestLibrary(),
		matcher: readest.NewMatcher(),
	}
}

func (h *ReadingHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/reading/progress", h.handleProgressList)
	mux.HandleFunc("/api/reading/progress/", h.handleProgressItem)
	mux.HandleFunc("/api/reading/start/", h.handleStartReading)
	mux.HandleFunc("/api/reading/stop/", h.handleStopReading)
	mux.HandleFunc("/api/reading/sessions/", h.handleSessions)
	mux.HandleFunc("/api/reading/queue", h.handleQueue)
	mux.HandleFunc("/api/reading/queue/", h.handleQueueItem)
	mux.HandleFunc("/api/reading/queue/reorder", h.handleQueueReorder)
	mux.HandleFunc("/api/reading/dashboard", h.handleDashboard)
	mux.HandleFunc("/api/reading/sync-focusd", h.handleSyncFocusd)
	mux.HandleFunc("/api/reading/finish/", h.handleFinish)
	mux.HandleFunc("/api/reading/sync-readest", h.handleSyncReadest)
	mux.HandleFunc("/api/reading/readest-status", h.handleReadestStatus)
}

func (h *ReadingHandler) handleProgressList(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	progress, err := h.db.GetAllReadingProgress()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if progress == nil {
		progress = []models.ReadingProgress{}
	}
	writeJSON(w, progress)
}

func (h *ReadingHandler) handleProgressItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/api/reading/progress/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		progress, err := h.db.GetReadingProgress(id)
		if err != nil {
			// Return an empty default instead of 404 — no progress yet
			// is a normal state, not an error worth logging in console.
			progress = &models.ReadingProgress{
				ItemID:         id,
				Status:         "unread",
				ProgressPercent: 0,
				CurrentPage:    0,
				TotalPages:     0,
			}
		}
		writeJSON(w, progress)

	case "POST":
		var p models.ReadingProgress
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.ItemID = id
		if err := h.db.UpsertReadingProgress(&p); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "updated"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *ReadingHandler) handleStartReading(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Path[len("/api/reading/start/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	session, err := h.db.StartReadingSession(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, session)
}

func (h *ReadingHandler) handleStopReading(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Path[len("/api/reading/stop/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Get active session
	session, err := h.db.GetActiveSession(id)
	if err != nil {
		http.Error(w, "no active session", http.StatusNotFound)
		return
	}

	pagesRead := 0
	if r.Body != nil {
		var body struct {
			PagesRead int `json:"pages_read"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		pagesRead = body.PagesRead
	}

	if err := h.db.StopReadingSession(session.ID, pagesRead); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "stopped"})
}

func (h *ReadingHandler) handleSessions(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/api/reading/sessions/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	sessions, err := h.db.GetReadingSessions(id, 20)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sessions == nil {
		sessions = []models.ReadingSession{}
	}
	writeJSON(w, sessions)
}

func (h *ReadingHandler) handleQueue(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		queue, err := h.db.GetReadingQueue()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if queue == nil {
			queue = []models.ReadingQueueItem{}
		}
		writeJSON(w, queue)

	case "POST":
		var item models.ReadingQueueItem
		if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if err := h.db.AddToReadingQueue(&item); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, item)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *ReadingHandler) handleQueueItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Path[len("/api/reading/queue/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.db.RemoveFromReadingQueue(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "removed"})
}

func (h *ReadingHandler) handleQueueReorder(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := h.db.ReorderReadingQueue(body.IDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "reordered"})
}

func (h *ReadingHandler) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	dashboard, err := h.db.GetReadingDashboard()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if dashboard.CurrentlyReading == nil {
		dashboard.CurrentlyReading = []models.ReadingStatusItem{}
	}
	if dashboard.Queue == nil {
		dashboard.Queue = []models.ReadingQueueItem{}
	}
	writeJSON(w, dashboard)
}

func (h *ReadingHandler) handleSyncFocusd(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Fetch reading plan from FocusD daemon
	resp, err := http.Get("http://localhost:8082/reading")
	if err != nil {
		http.Error(w, fmt.Sprintf("cannot reach FocusD daemon: %v", err), http.StatusServiceUnavailable)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "failed to read response", http.StatusInternalServerError)
		return
	}

	// Parse FocusD reading plan
	var plan struct {
		Today       string `json:"today"`
		CurrentBook *struct {
			Number    int    `json:"number"`
			Title     string `json:"title"`
			StartDate string `json:"start_date"`
			EndDate   string `json:"end_date"`
			Focus     string `json:"focus"`
		} `json:"current_book"`
		Books []struct {
			Number    int    `json:"number"`
			Title     string `json:"title"`
			StartDate string `json:"start_date"`
			EndDate   string `json:"end_date"`
			Focus     string `json:"focus"`
		} `json:"books"`
	}
	if err := json.Unmarshal(body, &plan); err != nil {
		http.Error(w, "invalid FocusD response", http.StatusInternalServerError)
		return
	}

	// Convert to reading queue items
	var queueItems []models.ReadingQueueItem
	for _, book := range plan.Books {
		queueItems = append(queueItems, models.ReadingQueueItem{
			FocusdBookNumber: &book.Number,
			Title:            book.Title,
			Author:           book.Focus,
			Priority:         book.Number,
		})
	}

	added, err := h.db.SyncFocusdReadingPlan(queueItems)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{
		"status": "synced",
		"added":  added,
	})
}

func (h *ReadingHandler) handleFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Path[len("/api/reading/finish/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := h.db.FinishReading(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Try to notify FocusD
	item, err := h.db.GetItem(id)
	if err == nil {
		// Search for matching task in FocusD and mark done
		searchURL := fmt.Sprintf("http://localhost:8082/tasks?q=%s", strings.ReplaceAll(item.Title, " ", "+"))
		resp, err := http.Get(searchURL)
		if err == nil {
			defer resp.Body.Close()
			// Best effort - don't fail if FocusD is down
		}
	}

	writeJSON(w, map[string]string{"status": "finished"})
}

// handleSyncReadest syncs reading progress from Readest to the library
func (h *ReadingHandler) handleSyncReadest(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get all books from Readest with progress
	readestBooks, err := h.readest.GetAllBooksWithProgress()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read Readest library: %v", err), http.StatusInternalServerError)
		return
	}

	if len(readestBooks) == 0 {
		writeJSON(w, models.ReadestSyncResult{
			Success:    true,
			Message:    "No books with progress found in Readest",
			SyncedAt:   time.Now(),
			TotalBooks: 0,
		})
		return
	}

	// Get all library items for matching
	libraryItems, err := h.db.GetAllItems()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get library items: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert to matcher format
	matcherItems := make([]readest.LibraryItem, len(libraryItems))
	for i, item := range libraryItems {
		matcherItems[i] = readest.LibraryItem{
			ID:       item.ID,
			Title:    item.Title,
			Path:     item.Path,
			Filename: item.Filename,
		}
	}

	// Match Readest books to library items
	results := h.matcher.MatchAll(readestBooks, matcherItems)

	// Update progress for matched books
	updatedCount := 0
	syncedBooks := make([]models.ReadestSyncedBook, 0, len(results))

	for _, result := range results {
		if result.LibraryItemID == -1 {
			continue // Skip unmatched
		}

		book := result.ReadestBook
		currentPage := 0
		totalPages := 0
		if len(book.Progress) >= 2 {
			currentPage = book.Progress[0]
			totalPages = book.Progress[1]
		}

		// Update database
		if err := h.db.UpdateProgressFromReadest(result.LibraryItemID, book.Hash, currentPage, totalPages); err != nil {
			continue // Skip on error
		}

		updatedCount++
		progressPercent := 0
		if totalPages > 0 {
			progressPercent = (currentPage * 100) / totalPages
		}

		matchStrategy := "path"
		switch result.MatchStrategy {
		case readest.MatchByFilename:
			matchStrategy = "filename"
		case readest.MatchByTitle:
			matchStrategy = "title"
		}

		syncedBooks = append(syncedBooks, models.ReadestSyncedBook{
			Hash:            book.Hash,
			Title:           book.Title,
			LibraryItemID:   result.LibraryItemID,
			CurrentPage:     currentPage,
			TotalPages:      totalPages,
			ProgressPercent: progressPercent,
			MatchStrategy:   matchStrategy,
			Confidence:      result.Confidence,
		})
	}

	// Get match stats
	stats := readest.GetMatchStats(results)

	writeJSON(w, models.ReadestSyncResult{
		Success:         true,
		Message:         fmt.Sprintf("Synced %d books from Readest", updatedCount),
		SyncedAt:        time.Now(),
		TotalBooks:      stats["total"].(int),
		MatchedBooks:    stats["matched"].(int),
		UnmatchedBooks:  stats["unmatched"].(int),
		UpdatedProgress: updatedCount,
		Books:           syncedBooks,
	})
}

// handleReadestStatus returns the current Readest sync status
func (h *ReadingHandler) handleReadestStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get Readest stats
	readestStats, err := h.readest.GetStats()
	if err != nil {
		// Readest might not be installed or configured
		writeJSON(w, models.ReadestSyncStatus{
			Enabled: false,
		})
		return
	}

	lastSync, _ := h.readest.GetLastSyncTime()
	var lastSyncPtr *time.Time
	if !lastSync.IsZero() {
		lastSyncPtr = &lastSync
	}

	status := &models.ReadestSyncStatus{
		Enabled:          true,
		LastSyncAt:       lastSyncPtr,
		TotalBooks:       readestStats["total_books"].(int),
		CurrentlyReading: readestStats["currently_reading"].(int),
	}

	writeJSON(w, status)
}
