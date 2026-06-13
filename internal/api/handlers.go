package api

import (
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/models"
)

type Handler struct {
	db *db.DB
}

func NewHandler(database *db.DB) *Handler {
	return &Handler{db: database}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/search", h.handleSearch)
	mux.HandleFunc("/api/items/", h.handleItems)
	mux.HandleFunc("/api/stats", h.handleStats)
	mux.HandleFunc("/api/categories", h.handleCategories)
	mux.HandleFunc("/api/tags", h.handleTags)
	mux.HandleFunc("/api/open/", h.handleOpen)
	mux.HandleFunc("/api/file/", h.handleFile)
}

// CORS middleware wraps a handler with CORS headers
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func (h *Handler) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := models.SearchQuery{
		Q:        r.URL.Query().Get("q"),
		Type:     r.URL.Query().Get("type"),
		Category: r.URL.Query().Get("category"),
		Tag:      r.URL.Query().Get("tag"),
		Sort:     r.URL.Query().Get("sort"),
		Order:    r.URL.Query().Get("order"),
	}

	if y := r.URL.Query().Get("year"); y != "" {
		q.Year, _ = strconv.Atoi(y)
	}
	if p := r.URL.Query().Get("page"); p != "" {
		q.Page, _ = strconv.Atoi(p)
	}
	if l := r.URL.Query().Get("limit"); l != "" {
		q.Limit, _ = strconv.Atoi(l)
	}

	result, err := h.db.Search(q)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, result)
}

func (h *Handler) handleItems(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/api/items/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		item, err := h.db.GetItem(id)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, item)

	case "DELETE":
		if err := h.db.DeleteItem(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "deleted"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.db.GetStats()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, stats)
}

func (h *Handler) handleCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.db.GetCategories()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, cats)
}

func (h *Handler) handleTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.db.GetTags()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, tags)
}

func (h *Handler) handleOpen(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/api/open/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	item, err := h.db.GetItem(id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var cmd *exec.Cmd
	ext := strings.ToLower(filepath.Ext(item.Path))

	// PDFs → sioyek
	if ext == ".pdf" {
		if _, lookErr := exec.LookPath("sioyek"); lookErr == nil {
			cmd = exec.Command("sioyek", item.Path)
		}
	}

	// Ebooks → readest
	if ext == ".epub" || ext == ".mobi" || ext == ".azw3" || ext == ".fb2" {
		if _, lookErr := exec.LookPath("readest"); lookErr == nil {
			cmd = exec.Command("readest", item.Path)
		}
	}

	// Fallback
	if cmd == nil {
		switch runtime.GOOS {
		case "linux":
			cmd = exec.Command("xdg-open", item.Path)
		case "darwin":
			cmd = exec.Command("open", item.Path)
		default:
			http.Error(w, "unsupported platform", http.StatusInternalServerError)
			return
		}
	}

	if err := cmd.Start(); err != nil {
		http.Error(w, fmt.Sprintf("failed to open: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "opened"})
}

func (h *Handler) handleFile(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[len("/api/file/"):]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	item, err := h.db.GetItem(id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Set Content-Type based on file extension
	ext := strings.ToLower(filepath.Ext(item.Path))
	if ct := mime.TypeByExtension(ext); ct != "" {
		w.Header().Set("Content-Type", ct)
	}

	http.ServeFile(w, r, item.Path)
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
