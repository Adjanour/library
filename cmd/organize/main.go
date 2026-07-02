package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/models"
)

var (
	unsafeName = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]`)
	collapse   = regexp.MustCompile(`\s+`)
)

func sanitizeName(s string) string {
	s = unsafeName.ReplaceAllString(s, "")
	s = collapse.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func sanitizeDir(s string) string {
	s = sanitizeName(s)
	if s == "" || strings.Trim(s, ".") == "" {
		return ""
	}
	return s
}

// buildFilename produces "Author - Title (Year).ext" from clean DB metadata.
func buildFilename(it models.Item) string {
	ext := filepath.Ext(it.Filename)
	if ext == "" {
		ext = filepath.Ext(it.Path)
	}
	name := strings.TrimSpace(it.Title)
	if name == "" {
		name = strings.TrimSuffix(it.Filename, ext)
	}
	if a := strings.TrimSpace(it.Authors); a != "" {
		first := strings.Split(a, ",")[0]
		first = strings.Split(first, ";")[0]
		if first = strings.TrimSpace(first); first != "" {
			name = first + " - " + name
		}
	}
	if it.Year > 0 {
		name = fmt.Sprintf("%s (%d)", name, it.Year)
	}
	name = sanitizeName(name)
	if name == "" {
		name = "untitled"
	}
	return name + ext
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func main() {
	home, _ := os.UserHomeDir()
	root := flag.String("root", filepath.Join(home, "Library"), "destination root directory")
	apply := flag.Bool("apply", false, "actually move files (default: dry-run)")
	minSize := flag.Int64("min-size", 102400, "skip files smaller than this many bytes")
	exclude := flag.String("exclude", "", "regex of source paths to skip")
	dbPath := flag.String("db", filepath.Join(home, ".local", "share", "library", "library.db"), "library database path")
	flag.Parse()

	absRoot, _ := filepath.Abs(*root)

	database, err := db.New(*dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	items, err := database.GetAllItems()
	if err != nil {
		fmt.Fprintf(os.Stderr, "load items: %v\n", err)
		os.Exit(1)
	}

	var exRE *regexp.Regexp
	if *exclude != "" {
		exRE, err = regexp.Compile(*exclude)
		if err != nil {
			fmt.Fprintf(os.Stderr, "bad exclude regex: %v\n", err)
			os.Exit(1)
		}
	}

	type plan struct {
		id   int64
		src  string
		dst  string
		skip string
	}
	var plans []plan
	dstSet := map[string]bool{}

	for _, it := range items {
		if it.Size < *minSize {
			plans = append(plans, plan{it.ID, it.Path, "", fmt.Sprintf("small (%d bytes)", it.Size)})
			continue
		}
		if exRE != nil && exRE.MatchString(it.Path) {
			plans = append(plans, plan{it.ID, it.Path, "", "excluded by --exclude"})
			continue
		}
		if strings.HasPrefix(filepath.Clean(it.Path)+string(filepath.Separator), absRoot+string(filepath.Separator)) {
			plans = append(plans, plan{it.ID, it.Path, "", "already in library"})
			continue
		}

		cat := sanitizeDir(it.Category)
		if cat == "" {
			cat = "uncategorized"
		}
		name := buildFilename(it)
		dst := filepath.Join(absRoot, cat, name)
		base := strings.TrimSuffix(dst, filepath.Ext(dst))
		ext := filepath.Ext(dst)
		i := 1
		for dstSet[dst] || fileExists(dst) {
			i++
			dst = fmt.Sprintf("%s (%d)%s", base, i, ext)
		}
		dstSet[dst] = true
		plans = append(plans, plan{it.ID, it.Path, dst, ""})
	}

	moveCount, skipCount := 0, 0
	for _, p := range plans {
		if p.skip != "" {
			skipCount++
			fmt.Printf("[SKIP] %s  (%s)\n", p.src, p.skip)
			continue
		}
		moveCount++
		fmt.Printf("[MOVE] %s\n    -> %s\n", p.src, p.dst)
	}

	fmt.Printf("\n%d to move, %d skipped\n", moveCount, skipCount)
	if moveCount == 0 {
		return
	}
	if !*apply {
		fmt.Println("\nDRY RUN — re-run with -apply to move files and update the index.")
		return
	}

	manifestDir := filepath.Join(absRoot, ".organize")
	if err := os.MkdirAll(manifestDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "create manifest dir: %v\n", err)
		os.Exit(1)
	}
	manifest := filepath.Join(manifestDir, fmt.Sprintf("manifest-%s.log", time.Now().Format("20060102-150405")))
	mf, err := os.Create(manifest)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create manifest: %v\n", err)
		os.Exit(1)
	}
	defer mf.Close()
	fmt.Fprintf(mf, "# organize manifest %s  (src\\tdst\\tid)\n", time.Now().Format(time.RFC3339))

	moved := 0
	for _, p := range plans {
		if p.skip != "" || p.dst == "" {
			continue
		}
		if _, err := os.Stat(p.src); err != nil {
			fmt.Printf("[MISS] %s\n", p.src)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p.dst), 0755); err != nil {
			fmt.Printf("[ERR]  %s: %v\n", p.src, err)
			continue
		}
		if err := os.Rename(p.src, p.dst); err != nil {
			fmt.Printf("[ERR]  %s: %v\n", p.src, err)
			continue
		}
		fmt.Fprintf(mf, "%s\t%s\t%d\n", p.src, p.dst, p.id)
		if err := database.UpdateItemPath(p.id, p.dst, filepath.Base(p.dst)); err != nil {
			fmt.Printf("[WARN] db update for %d: %v\n", p.id, err)
		}
		moved++
	}
	fmt.Printf("\nMoved %d files.\nManifest written to: %s\n", moved, manifest)
}
