package readest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ReadestBook represents a book from Readest's library.json
type ReadestBook struct {
	Hash         string                 `json:"hash"`
	Format       string                 `json:"format"`
	Title        string                 `json:"title"`
	SourceTitle  string                 `json:"sourceTitle"`
	PrimaryLang  string                 `json:"primaryLanguage"`
	Author       string                 `json:"author"`
	Metadata     map[string]interface{} `json:"metadata"`
	CreatedAt    int64                  `json:"createdAt"`
	UploadedAt   *int64                 `json:"uploadedAt"`
	DeletedAt    *int64                 `json:"deletedAt"`
	DownloadedAt *int64                 `json:"downloadedAt"`
	UpdatedAt    int64                  `json:"updatedAt"`
	MetaHash     string                 `json:"metaHash"`
	Progress     []int                  `json:"progress"` // [currentPage, totalPages]
}

// ReadestConfig represents per-book config.json
type ReadestConfig struct {
	UpdatedAt       int64                  `json:"updatedAt"`
	ViewSettings    map[string]interface{} `json:"viewSettings"`
	SearchConfig    map[string]interface{} `json:"searchConfig"`
	Progress        []int                  `json:"progress"` // [currentPage, totalPages]
	Location        string                 `json:"location"` // epubcfi position
	LastSyncedAtCfg *int64                 `json:"lastSyncedAtConfig"`
	LastSyncedAtNt  *int64                 `json:"lastSyncedAtNotes"`
}

// ReadestBookEnriched is a ReadestBook with config data merged
type ReadestBookEnriched struct {
	ReadestBook
	Config             *ReadestConfig
	FilePath           string // Actual path to the epub file
	ProgressPct        int    // Calculated percentage
	IsCurrentlyReading bool
}

// ReadestLibrary manages reading from Readest data directories
type ReadestLibrary struct {
	DataDirs []string // Multiple possible data directories
}

// NewReadestLibrary creates a new ReadestLibrary with default paths
func NewReadestLibrary() *ReadestLibrary {
	home, _ := os.UserHomeDir()

	dirs := []string{
		// Flatpak data directory
		filepath.Join(home, ".var/app/com.bilingify.readest/data/com.bilingify.readest/Readest/Books"),
		// Testing directory
		filepath.Join(home, "Documents/testing-readest/Readest/Books"),
		// User-configured directory (future)
	}

	return &ReadestLibrary{
		DataDirs: dirs,
	}
}

// NewReadestLibraryWithDirs creates a ReadestLibrary with custom directories
func NewReadestLibraryWithDirs(dirs []string) *ReadestLibrary {
	return &ReadestLibrary{DataDirs: dirs}
}

// findLibraryJSON locates library.json in the data directories
func (r *ReadestLibrary) findLibraryJSON() (string, error) {
	for _, dir := range r.DataDirs {
		path := filepath.Join(dir, "library.json")
		if _, err := os.Stat(path); err == nil {
			return dir, nil
		}
	}
	return "", fmt.Errorf("readest library.json not found in any of: %v", r.DataDirs)
}

// ReadLibrary reads the Readest library.json file
func (r *ReadestLibrary) ReadLibrary() ([]ReadestBook, error) {
	dataDir, err := r.findLibraryJSON()
	if err != nil {
		return nil, err
	}

	path := filepath.Join(dataDir, "library.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read library.json: %w", err)
	}

	var books []ReadestBook
	if err := json.Unmarshal(data, &books); err != nil {
		return nil, fmt.Errorf("failed to parse library.json: %w", err)
	}

	return books, nil
}

// ReadBookConfig reads a book's config.json
func (r *ReadestLibrary) ReadBookConfig(hash string) (*ReadestConfig, error) {
	dataDir, err := r.findLibraryJSON()
	if err != nil {
		return nil, err
	}

	configPath := filepath.Join(dataDir, hash, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No config file is OK
		}
		return nil, fmt.Errorf("failed to read config.json for %s: %w", hash, err)
	}

	var config ReadestConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config.json for %s: %w", hash, err)
	}

	return &config, nil
}

// findBookFile finds the actual epub/pdf file in a book directory
func (r *ReadestLibrary) findBookFile(hash string) (string, error) {
	dataDir, err := r.findLibraryJSON()
	if err != nil {
		return "", err
	}

	bookDir := filepath.Join(dataDir, hash)
	entries, err := os.ReadDir(bookDir)
	if err != nil {
		return "", fmt.Errorf("failed to read book directory %s: %w", hash, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext == ".epub" || ext == ".pdf" || ext == ".mobi" || ext == ".azw3" || ext == ".fb2" {
			return filepath.Join(bookDir, entry.Name()), nil
		}
	}

	return "", fmt.Errorf("no book file found in %s", bookDir)
}

// GetAllBooksWithProgress returns all books that have reading progress
func (r *ReadestLibrary) GetAllBooksWithProgress() ([]ReadestBookEnriched, error) {
	books, err := r.ReadLibrary()
	if err != nil {
		return nil, err
	}

	var enriched []ReadestBookEnriched

	for _, book := range books {
		// Skip books with no progress
		if len(book.Progress) < 2 || book.Progress[0] == 0 {
			continue
		}

		e := ReadestBookEnriched{
			ReadestBook: book,
		}

		// Read config for detailed position
		config, _ := r.ReadBookConfig(book.Hash)
		if config != nil {
			e.Config = config
			// Prefer config progress if available (more accurate)
			if len(config.Progress) >= 2 && config.Progress[0] > 0 {
				e.Progress = config.Progress
			}
		}

		// Find actual file path
		filePath, _ := r.findBookFile(book.Hash)
		if filePath != "" {
			e.FilePath = filePath
		}

		// Calculate percentage
		if len(e.Progress) >= 2 && e.Progress[1] > 0 {
			e.ProgressPct = (e.Progress[0] * 100) / e.Progress[1]
		}

		// Consider "currently reading" if progress > 0 and < 100%
		e.IsCurrentlyReading = e.ProgressPct > 0 && e.ProgressPct < 100

		enriched = append(enriched, e)
	}

	// Sort by most recently updated
	sort.Slice(enriched, func(i, j int) bool {
		return enriched[i].UpdatedAt > enriched[j].UpdatedAt
	})

	return enriched, nil
}

// GetBookByHash returns a single enriched book by its hash
func (r *ReadestLibrary) GetBookByHash(hash string) (*ReadestBookEnriched, error) {
	books, err := r.ReadLibrary()
	if err != nil {
		return nil, err
	}

	for _, book := range books {
		if book.Hash == hash {
			e := &ReadestBookEnriched{
				ReadestBook: book,
			}

			config, _ := r.ReadBookConfig(book.Hash)
			if config != nil {
				e.Config = config
				if len(config.Progress) >= 2 && config.Progress[0] > 0 {
					e.Progress = config.Progress
				}
			}

			filePath, _ := r.findBookFile(book.Hash)
			if filePath != "" {
				e.FilePath = filePath
			}

			if len(e.Progress) >= 2 && e.Progress[1] > 0 {
				e.ProgressPct = (e.Progress[0] * 100) / e.Progress[1]
			}
			e.IsCurrentlyReading = e.ProgressPct > 0 && e.ProgressPct < 100

			return e, nil
		}
	}

	return nil, fmt.Errorf("book with hash %s not found", hash)
}

// GetLastSyncTime returns the most recent UpdatedAt timestamp across all books
func (r *ReadestLibrary) GetLastSyncTime() (time.Time, error) {
	books, err := r.ReadLibrary()
	if err != nil {
		return time.Time{}, err
	}

	var latest int64
	for _, book := range books {
		if book.UpdatedAt > latest {
			latest = book.UpdatedAt
		}
	}

	if latest == 0 {
		return time.Time{}, nil
	}

	// Readest timestamps are in milliseconds
	return time.UnixMilli(latest), nil
}

// GetStats returns summary statistics about the Readest library
func (r *ReadestLibrary) GetStats() (map[string]interface{}, error) {
	books, err := r.ReadLibrary()
	if err != nil {
		return nil, err
	}

	total := len(books)
	withProgress := 0
	currentlyReading := 0
	finished := 0

	for _, book := range books {
		if len(book.Progress) >= 2 && book.Progress[0] > 0 {
			withProgress++
			pct := (book.Progress[0] * 100) / book.Progress[1]
			if pct >= 100 {
				finished++
			} else if pct > 0 {
				currentlyReading++
			}
		}
	}

	lastSync, _ := r.GetLastSyncTime()

	return map[string]interface{}{
		"total_books":       total,
		"with_progress":     withProgress,
		"currently_reading": currentlyReading,
		"finished":          finished,
		"last_sync":         lastSync,
	}, nil
}
