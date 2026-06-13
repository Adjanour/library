package readest

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MatchStrategy defines how to link Readest books to library items
type MatchStrategy int

const (
	MatchByPath    MatchStrategy = iota // Exact path match
	MatchByFilename                     // Basename match
	MatchByTitle                        // Fuzzy title match
)

// MatchResult represents a matched book
type MatchResult struct {
	ReadestBook    ReadestBookEnriched
	LibraryItemID  int64         // -1 if no match
	LibraryTitle   string        // Title from library (for verification)
	MatchStrategy  MatchStrategy
	Confidence     float64       // 0.0 - 1.0
}

// LibraryItem represents a minimal item from the library for matching
type LibraryItem struct {
	ID       int64
	Title    string
	Path     string
	Filename string
}

// Matcher matches Readest books to library items
type Matcher struct {
	normalizer *titleNormalizer
}

// NewMatcher creates a new Matcher
func NewMatcher() *Matcher {
	return &Matcher{
		normalizer: newTitleNormalizer(),
	}
}

// titleNormalizer handles title normalization for fuzzy matching
type titleNormalizer struct {
	specialChars *regexp.Regexp
	multiSpace   *regexp.Regexp
}

func newTitleNormalizer() *titleNormalizer {
	return &titleNormalizer{
		specialChars: regexp.MustCompile(`[^\w\s]`),
		multiSpace:   regexp.MustCompile(`\s+`),
	}
}

// normalize normalizes a title for comparison
func (n *titleNormalizer) normalize(title string) string {
	// Lowercase
	title = strings.ToLower(title)
	// Remove special characters
	title = n.specialChars.ReplaceAllString(title, "")
	// Collapse whitespace
	title = n.multiSpace.ReplaceAllString(title, " ")
	// Trim
	title = strings.TrimSpace(title)
	return title
}

// normalizeForFilename normalizes for filename comparison
func (n *titleNormalizer) normalizeForFilename(title string) string {
	// Remove common suffixes like "(for True Epub)", "(for . .)"
	title = regexp.MustCompile(`\(for[^)]*\)`).ReplaceAllString(title, "")
	// Remove special characters except spaces
	title = regexp.MustCompile(`[^\w\s]`).ReplaceAllString(title, "")
	// Collapse whitespace
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")
	return strings.TrimSpace(title)
}

// calculateTitleSimilarity calculates similarity between two titles (0.0 - 1.0)
func (m *Matcher) calculateTitleSimilarity(a, b string) float64 {
	a = m.normalizer.normalize(a)
	b = m.normalizer.normalize(b)
	
	// Exact match after normalization
	if a == b {
		return 1.0
	}
	
	// One contains the other
	if strings.Contains(a, b) || strings.Contains(b, a) {
		return 0.9
	}
	
	// Check if titles start the same (handles truncation)
	minLen := len(a)
	if len(b) < minLen {
		minLen = len(b)
	}
	if minLen > 10 {
		aPrefix := a[:minLen]
		bPrefix := b[:minLen]
		if aPrefix == bPrefix {
			return 0.85
		}
	}
	
	// Word overlap calculation
	aWords := strings.Fields(a)
	bWords := strings.Fields(b)
	
	if len(aWords) == 0 || len(bWords) == 0 {
		return 0.0
	}
	
	// Count matching words
	matchCount := 0
	bWordSet := make(map[string]bool)
	for _, w := range bWords {
		bWordSet[w] = true
	}
	for _, w := range aWords {
		if bWordSet[w] {
			matchCount++
		}
	}
	
	// Jaccard-like similarity
	totalWords := len(aWords) + len(bWords) - matchCount
	if totalWords == 0 {
		return 0.0
	}
	
	return float64(matchCount) / float64(totalWords)
}

// extractFilename extracts the base filename without extension
func extractFilename(path string) string {
	return strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
}

// MatchAll matches all Readest books to library items
func (m *Matcher) MatchAll(readestBooks []ReadestBookEnriched, libraryItems []LibraryItem) []MatchResult {
	results := make([]MatchResult, 0, len(readestBooks))
	
	// Build indexes for faster lookup
	pathIndex := make(map[string]int64)    // normalized path -> item ID
	filenameIndex := make(map[string]int64) // normalized filename -> item ID
	
	for _, item := range libraryItems {
		// Index by path
		normalizedPath := strings.ToLower(item.Path)
		pathIndex[normalizedPath] = item.ID
		
		// Index by normalized filename
		normalizedFilename := m.normalizer.normalizeForFilename(extractFilename(item.Filename))
		if normalizedFilename != "" {
			filenameIndex[normalizedFilename] = item.ID
		}
	}
	
	for _, book := range readestBooks {
		result := MatchResult{
			ReadestBook:   book,
			LibraryItemID: -1,
			Confidence:    0.0,
		}
		
		// Strategy 1: Match by file path
		if book.FilePath != "" {
			normalizedPath := strings.ToLower(book.FilePath)
			if id, ok := pathIndex[normalizedPath]; ok {
				result.LibraryItemID = id
				result.MatchStrategy = MatchByPath
				result.Confidence = 1.0
				results = append(results, result)
				continue
			}
		}
		
		// Strategy 2: Match by filename
		if book.FilePath != "" {
			normalizedFilename := m.normalizer.normalizeForFilename(extractFilename(book.FilePath))
			if normalizedFilename != "" {
				if id, ok := filenameIndex[normalizedFilename]; ok {
					result.LibraryItemID = id
					result.MatchStrategy = MatchByFilename
					result.Confidence = 0.9
					results = append(results, result)
					continue
				}
			}
		}
		
		// Also try matching by title from Readest (without extension)
		if book.FilePath != "" {
			titleFromFilename := m.normalizer.normalizeForFilename(book.Title)
			if titleFromFilename != "" {
				if id, ok := filenameIndex[titleFromFilename]; ok {
					result.LibraryItemID = id
					result.MatchStrategy = MatchByFilename
					result.Confidence = 0.85
					results = append(results, result)
					continue
				}
			}
		}
		
		// Strategy 3: Fuzzy title match
		bestID := int64(-1)
		bestScore := 0.0
		bestTitle := ""
		
		for _, item := range libraryItems {
			score := m.calculateTitleSimilarity(book.Title, item.Title)
			if score > bestScore && score >= 0.6 { // Minimum threshold
				bestScore = score
				bestID = item.ID
				bestTitle = item.Title
			}
		}
		
		if bestID != -1 {
			result.LibraryItemID = bestID
			result.LibraryTitle = bestTitle
			result.MatchStrategy = MatchByTitle
			result.Confidence = bestScore
		}
		
		results = append(results, result)
	}
	
	return results
}

// GetMatchStats returns statistics about matching results
func GetMatchStats(results []MatchResult) map[string]interface{} {
	total := len(results)
	matched := 0
	unmatched := 0
	byPath := 0
	byFilename := 0
	byTitle := 0
	lowConfidence := 0
	
	for _, r := range results {
		if r.LibraryItemID != -1 {
			matched++
			switch r.MatchStrategy {
			case MatchByPath:
				byPath++
			case MatchByFilename:
				byFilename++
			case MatchByTitle:
				byTitle++
			}
			if r.Confidence < 0.7 {
				lowConfidence++
			}
		} else {
			unmatched++
		}
	}
	
	return map[string]interface{}{
		"total":           total,
		"matched":         matched,
		"unmatched":       unmatched,
		"by_path":         byPath,
		"by_filename":     byFilename,
		"by_title":        byTitle,
		"low_confidence":  lowConfidence,
	}
}

// GetUnmatchedBooks returns books that couldn't be matched
func GetUnmatchedBooks(results []MatchResult) []ReadestBookEnriched {
	var unmatched []ReadestBookEnriched
	for _, r := range results {
		if r.LibraryItemID == -1 {
			unmatched = append(unmatched, r.ReadestBook)
		}
	}
	return unmatched
}

// isPathAccessible checks if a file path is accessible
func isPathAccessible(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
