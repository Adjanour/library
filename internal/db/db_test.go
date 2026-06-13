package db

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/bernard/library/internal/models"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	dir := t.TempDir()
	db, err := New(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("failed to create test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func makeItem(title, path, filename, dtype, category, tags string) *models.Item {
	return &models.Item{
		Title:    title,
		Path:     path,
		Filename: filename,
		Type:     models.BookType(dtype),
		Category: category,
		Tags:     tags,
		Size:     1000,
	}
}

func TestUpsertAndGetItem(t *testing.T) {
	db := newTestDB(t)

	item := makeItem("Test Book", "/path/to/book.pdf", "book.pdf", "book", "test", "guide")

	if err := db.UpsertItem(item); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if item.ID == 0 {
		t.Fatal("expected non-zero ID after upsert")
	}

	got, err := db.GetItem(item.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "Test Book" {
		t.Errorf("title = %q, want %q", got.Title, "Test Book")
	}

	item.Title = "Updated Book"
	if err := db.UpsertItem(item); err != nil {
		t.Fatalf("upsert update: %v", err)
	}

	got, err = db.GetItem(item.ID)
	if err != nil {
		t.Fatalf("get after update: %v", err)
	}
	if got.Title != "Updated Book" {
		t.Errorf("title = %q, want %q", got.Title, "Updated Book")
	}
}

func TestSearchDefault(t *testing.T) {
	db := newTestDB(t)

	for i := 0; i < 5; i++ {
		item := makeItem(
			"Item "+string(rune('A'+i)),
			"/path/item"+string(rune('a'+i))+".pdf",
			"item"+string(rune('a'+i))+".pdf",
			"book", "test", "",
		)
		db.UpsertItem(item)
	}

	result, err := db.Search(models.SearchQuery{Limit: 20})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if result.Total != 5 {
		t.Errorf("total = %d, want 5", result.Total)
	}
	if len(result.Items) != 5 {
		t.Errorf("items = %d, want 5", len(result.Items))
	}
}

func TestSearchWithQuery(t *testing.T) {
	db := newTestDB(t)

	items := []struct {
		title  string
		author string
	}{
		{"Go Programming", "Alan Donovan"},
		{"Design Patterns", "Gang of Four"},
		{"The Go Programming Language", "Alan Donovan"},
	}
	for _, it := range items {
		item := &models.Item{
			Title:   it.title,
			Authors: it.author,
			Path:    "/path/" + it.title + ".pdf",
			Type:    models.TypeBook,
		}
		db.UpsertItem(item)
	}

	result, err := db.Search(models.SearchQuery{Q: "Go", Limit: 20})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("total = %d, want 2 (matches 'Go Programming' and 'The Go Programming Language')", result.Total)
	}
}

func TestSearchWithFilters(t *testing.T) {
	db := newTestDB(t)

	for _, item := range []*models.Item{
		makeItem("Book A", "/a.pdf", "a.pdf", "book", "programming", "beginner"),
		makeItem("Paper B", "/b.pdf", "b.pdf", "paper", "research", "advanced"),
		makeItem("Thesis C", "/c.pdf", "c.pdf", "thesis", "research", ""),
		makeItem("Ebook D", "/d.epub", "d.epub", "ebook", "fiction", ""),
	} {
		db.UpsertItem(item)
	}

	tests := []struct {
		name  string
		query models.SearchQuery
		want  int
	}{
		{"filter by type=book", models.SearchQuery{Type: "book", Limit: 20}, 1},
		{"filter by category=research", models.SearchQuery{Category: "research", Limit: 20}, 2},
		{"filter by type=paper+category=research", models.SearchQuery{Type: "paper", Category: "research", Limit: 20}, 1},
		{"filter by year", models.SearchQuery{Year: 2020, Limit: 20}, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := db.Search(tt.query)
			if err != nil {
				t.Fatalf("search: %v", err)
			}
			if result.Total != tt.want {
				t.Errorf("total = %d, want %d", result.Total, tt.want)
			}
		})
	}
}

func TestGetAllPaths(t *testing.T) {
	db := newTestDB(t)
	db.UpsertItem(makeItem("A", "/a.pdf", "a.pdf", "book", "", ""))
	db.UpsertItem(makeItem("B", "/b.pdf", "b.pdf", "book", "", ""))

	paths, err := db.GetAllPaths()
	if err != nil {
		t.Fatalf("GetAllPaths: %v", err)
	}

	if !paths["/a.pdf"] {
		t.Error("expected /a.pdf in paths")
	}
	if !paths["/b.pdf"] {
		t.Error("expected /b.pdf in paths")
	}
	if paths["/c.pdf"] {
		t.Error("did not expect /c.pdf in paths")
	}
}

func TestDuplicatePath(t *testing.T) {
	db := newTestDB(t)
	db.UpsertItem(makeItem("Original", "/same.pdf", "same.pdf", "book", "", ""))

	err := db.UpsertItem(makeItem("Duplicate", "/same.pdf", "same.pdf", "paper", "", ""))
	if err != nil {
		t.Fatalf("upsert on conflict: %v", err)
	}

	paths, _ := db.GetAllPaths()
	if len(paths) != 1 {
		t.Errorf("expected 1 path, got %d", len(paths))
	}
}

func TestDescriptionField(t *testing.T) {
	db := newTestDB(t)

	item := makeItem("With Desc", "/desc.pdf", "desc.pdf", "book", "test", "")
	item.Description = "A test description"
	db.UpsertItem(item)

	got, err := db.GetItem(item.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Description != "A test description" {
		t.Errorf("description = %q, want %q", got.Description, "A test description")
	}
}

func TestEmptyDB(t *testing.T) {
	db := newTestDB(t)

	result, err := db.Search(models.SearchQuery{Limit: 20})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if result.Total != 0 {
		t.Errorf("total = %d, want 0", result.Total)
	}

	paths, err := db.GetAllPaths()
	if err != nil {
		t.Fatalf("GetAllPaths: %v", err)
	}
	if len(paths) != 0 {
		t.Errorf("paths = %d, want 0", len(paths))
	}

	stats, err := db.GetStats()
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.TotalItems != 0 {
		t.Errorf("TotalItems = %d, want 0", stats.TotalItems)
	}
}

func TestDBFileCreation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "db", "library.db")

	db, err := New(path)
	if err != nil {
		t.Fatalf("new with nested dir: %v", err)
	}
	db.Close()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Error("database file was not created")
	}
}
