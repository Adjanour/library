package scanner

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/models"
)

var (
	yearRegex   = regexp.MustCompile(`\b(19|20)\d{2}\b`)
	authorRegex = regexp.MustCompile(`\(([^)]+)\)`)
	cleanTitle  = regexp.MustCompile(`[_\-,.]+`)

	badTitleRegex = regexp.MustCompile(`(?i)^(course\s*name|anonymous|microsoft\s+word\s*-|\.rtf$|^[\d\s]+$|^[\.\-\s]+$)`)

	arxivLine     = regexp.MustCompile(`(?i)arxiv\s*:\s*\d{4}\.\d+`)
	skipLineRE    = regexp.MustCompile(`(?i)^\s*(provided proper attribution|project gutenberg|abstract|keywords?\s*:|©|fig\.|table\s*\d+|references?\s*|https?:\/\/|all\s+rights\s+reserved|published\s+(as|in)|proceedings\s+of|introduction|page\s*\d+|doi\s*:)`)
	affiliationRE = regexp.MustCompile(`(?i)^\s*\d+\s+[a-z]|(university|institute|department|research\s+(scientist|fellow|assistant|engineer)|lab[\s,]|google|microsoft|amazon|ibm|meta\s|apple[,\.]|inc[\.\s]|ltd[\.\s]|corp[\.\s])`)

	// extractTitle regexes (compiled once, not per-call)
	zlibrarySK   = regexp.MustCompile(`\s*\(z-library\.sk.*?\)\s*`)
	zlibOrg      = regexp.MustCompile(`\s*\(z-lib\.org.*?\)\s*`)
	oneLibSK     = regexp.MustCompile(`\s*\(1lib\.sk.*?\)\s*`)
	zlibraryCap  = regexp.MustCompile(`\s*\(Z-Library\)\s*`)
	trailingNums = regexp.MustCompile(`\s*\(\d+\)\s*$`)
	parens       = regexp.MustCompile(`\([^)]*\)`)
	whitespace   = regexp.MustCompile(`\s+`)
)

// Additional bad-metadata detection regexes
var (
	isISBN            = regexp.MustCompile(`^[\d][\d\s-]{8,}[\dXx]$`)
	isDateStamp       = regexp.MustCompile(`^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}([, ]+\d{1,2}:\d{2})?`)
	hasFileExt        = regexp.MustCompile(`\.[a-zA-Z0-9]{2,4}$`)
	nonPrintable      = regexp.MustCompile(`[\x00-\x08\x0e-\x1f\x7f-\x9f]`)
	hasRealWord       = regexp.MustCompile(`[a-zA-Z]{3,}`)
	watermarkPatterns = regexp.MustCompile(`(?i)^(from the library of|wow! ?ebook|converted by|downloaded by|this is a preview|scanned by|digitally signed|d0wnl0ad|www\.)`)
)

type Scanner struct {
	db         *db.DB
	dirs       []string
	extensions map[string]models.BookType
}

func New(database *db.DB, dirs []string) *Scanner {
	return &Scanner{
		db:   database,
		dirs: dirs,
		extensions: map[string]models.BookType{
			".pdf":  models.TypeBook,
			".epub": models.TypeEbook,
			".mobi": models.TypeEbook,
			".djvu": models.TypeBook,
		},
	}
}

func (s *Scanner) ScanAll(progress func(current, total int, filename string)) (int, error) {
	return s.ScanAllOpts(progress, false)
}

func (s *Scanner) ScanAllOpts(progress func(current, total int, filename string), force bool) (int, error) {
	existingPaths, err := s.db.GetAllPaths()
	if err != nil {
		return 0, err
	}

	var files []string
	for _, dir := range s.dirs {
		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if _, ok := s.extensions[ext]; ok {
				if force || !existingPaths[path] {
					files = append(files, path)
				}
			}
			return nil
		})
	}

	indexed := 0
	for i, path := range files {
		if progress != nil {
			progress(i+1, len(files), filepath.Base(path))
		}

		item := s.ParseFile(path)
		if err := s.db.UpsertItem(item); err != nil {
			continue
		}
		indexed++
	}

	return indexed, nil
}

func isBadMetadata(s string) bool {
	if s == "" || s == "-" {
		return true
	}
	if len(s) < 5 {
		return true
	}
	cleaned := nonPrintable.ReplaceAllString(s, "")
	if len(cleaned) < len(s)/2 {
		return true
	}
	// Strip parentheses before checking patterns like (anonymous)
	stripped := parens.ReplaceAllString(cleaned, "")
	stripped = strings.TrimSpace(stripped)
	if stripped == "" {
		return true
	}
	if badTitleRegex.MatchString(stripped) {
		return true
	}
	if badTitleRegex.MatchString(s) {
		return true
	}
	// Catch "anonymous" anywhere in the string (e.g. "(anonymous)")
	if strings.Contains(strings.ToLower(s), "anonymous") {
		return true
	}
	if isISBN.MatchString(strings.TrimSpace(s)) {
		return true
	}
	if isDateStamp.MatchString(strings.TrimSpace(s)) {
		return true
	}
	if hasFileExt.MatchString(s) {
		return true
	}
	if watermarkPatterns.MatchString(s) {
		return true
	}
	if !hasRealWord.MatchString(cleaned) {
		return true
	}
	// High special-character ratio → garbled font output
	special := 0
	for _, c := range cleaned {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ') {
			special++
		}
	}
	if len(cleaned) > 10 && special*100/len(cleaned) > 20 {
		return true
	}
	// No lowercase letters at all → likely garbled shifted-font or all-caps junk
	lower := 0
	for _, c := range cleaned {
		if c >= 'a' && c <= 'z' {
			lower++
		}
	}
	if len(cleaned) > 10 && lower == 0 {
		return true
	}
	return false
}

// cleanMetadata strips control characters and tidies up extracted text.
func cleanMetadata(s string) string {
	s = nonPrintable.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	return s
}

func looksLikeLegal(s string) bool {
	lower := strings.ToLower(s)
	keywords := []string{"provided proper attribution", "project gutenberg", "all rights reserved",
		"permission to reproduce", "scholarly works", "journalistic or scholarly",
		"reproduce the tables", "terms of service", "license", "copyright"}
	for _, k := range keywords {
		if strings.Contains(lower, k) {
			return true
		}
	}
	return false
}

func looksLikeAffiliation(s string) bool {
	return strings.Contains(s, "@") || affiliationRE.MatchString(s)
}

func hasAuthorMarker(s string) bool {
	return regexp.MustCompile(`(?i)\b[a-z]+\d\b`).MatchString(s)
}

func extractTitleFromFirstPage(path string) string {
	out, err := exec.Command("pdftotext", "-l", "1", path, "-").Output()
	if err != nil {
		return ""
	}
	text := string(out)
	lines := strings.Split(text, "\n")

	arxivIdx := -1
	for i, line := range lines {
		if arxivLine.MatchString(line) {
			arxivIdx = i
			break
		}
	}

	var startIdx int
	if arxivIdx >= 0 {
		for i := arxivIdx - 1; i >= 0; i-- {
			s := strings.TrimSpace(lines[i])
			if s == "" {
				continue
			}
			if looksLikeLegal(s) || looksLikeAffiliation(s) || strings.Contains(strings.ToLower(s), "arxiv") {
				continue
			}
			if len(s) < 10 || s == strings.ToLower(s) {
				continue
			}
			if isBadMetadata(s) {
				continue
			}
			if hasAuthorMarker(s) {
				continue
			}
			return strings.TrimRight(s, ".,;:")
		}
		startIdx = arxivIdx + 1
	}

	for i := startIdx; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" {
			continue
		}
		if strings.Contains(strings.ToLower(trimmed), "arxiv") {
			continue
		}
		if isBadMetadata(trimmed) {
			continue
		}
		if skipLineRE.MatchString(trimmed) {
			continue
		}
		if looksLikeAffiliation(trimmed) {
			continue
		}
		if hasAuthorMarker(trimmed) {
			continue
		}
		if len(trimmed) < 10 || len(trimmed) > 300 {
			continue
		}
		return strings.TrimRight(trimmed, ".,;:")
	}

	return ""
}

func (s *Scanner) ParseFile(path string) *models.Item {
	info, _ := os.Stat(path)
	filename := filepath.Base(path)
	ext := strings.ToLower(filepath.Ext(path))

	item := &models.Item{
		Path:     path,
		Filename: filename,
		Type:     s.extensions[ext],
		Size:     info.Size(),
	}

	if ext == ".pdf" {
		item.Type = guessType(path, filename)
		title, author, subject := extractPDFMetadata(path)
		title = cleanMetadata(title)
		if isBadMetadata(title) {
			title = cleanMetadata(extractTitleFromFirstPage(path))
		}
		if isBadMetadata(title) {
			title = extractTitle(filename)
		}
		if isBadMetadata(title) {
			title = titleCaseFilename(filename)
		}
		item.Title = title

		author = cleanMetadata(author)
		if author != "" && !isBadMetadata(author) {
			item.Authors = author
		} else {
			item.Authors = extractAuthors(filename)
		}
		if subject != "" {
			item.Description = cleanMetadata(subject)
		}
	} else if ext == ".epub" {
		title, author, desc, year := extractEPUBMetadata(path)
		title = cleanMetadata(title)
		if isBadMetadata(title) {
			title = extractTitle(filename)
		}
		if isBadMetadata(title) {
			title = titleCaseFilename(filename)
		}
		item.Title = title
		author = cleanMetadata(author)
		if author != "" && !isBadMetadata(author) {
			item.Authors = author
		} else {
			item.Authors = extractAuthors(filename)
		}
		if desc != "" {
			item.Description = cleanMetadata(desc)
		}
		if year > 0 {
			item.Year = year
		}
	} else {
		title := extractTitle(filename)
		if isBadMetadata(title) {
			title = titleCaseFilename(filename)
		}
		item.Title = title
		item.Authors = extractAuthors(filename)
	}

	if item.Year == 0 {
		item.Year = extractYear(filename)
	}
	item.Category = guessCategory(path, filename)
	item.Tags = guessTags(path, filename)
	item.Purpose = guessPurpose(item.Title, item.Category, item.Tags, item.Description, item.Filename)

	return item
}

func extractPDFMetadata(path string) (title, author, subject string) {
	out, err := exec.Command("pdfinfo", path).Output()
	if err != nil {
		return "", "", ""
	}
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "Title:") {
			title = strings.TrimSpace(strings.TrimPrefix(line, "Title:"))
		} else if strings.HasPrefix(line, "Author:") {
			author = strings.TrimSpace(strings.TrimPrefix(line, "Author:"))
		} else if strings.HasPrefix(line, "Subject:") {
			subject = strings.TrimSpace(strings.TrimPrefix(line, "Subject:"))
		}
	}
	return
}

func decodeEntities(s string) string {
	r := strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", "\"", "&#39;", "'", "&apos;", "'")
	return r.Replace(s)
}

func firstXMLField(xml, field string) string {
	re := regexp.MustCompile(`(?is)<(?:[a-zA-Z]+:)?` + regexp.QuoteMeta(field) + `[^>]*>(.*?)</(?:[a-zA-Z]+:)?` + regexp.QuoteMeta(field) + `>`)
	m := re.FindStringSubmatch(xml)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(decodeEntities(m[1]))
}

func allXMLFields(xml, field string) []string {
	re := regexp.MustCompile(`(?is)<(?:[a-zA-Z]+:)?` + regexp.QuoteMeta(field) + `[^>]*>(.*?)</(?:[a-zA-Z]+:)?` + regexp.QuoteMeta(field) + `>`)
	matches := re.FindAllStringSubmatch(xml, -1)
	out := []string{}
	for _, m := range matches {
		s := strings.TrimSpace(decodeEntities(m[1]))
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// extractEPUBMetadata reads title/author/description/year from an EPUB's OPF
// package using unzip (no Go zip dependency required).
func extractEPUBMetadata(path string) (title, author, description string, year int) {
	containerOut, err := exec.Command("unzip", "-p", path, "META-INF/container.xml").Output()
	if err != nil {
		return
	}
	opfPathRE := regexp.MustCompile(`full-path="([^"]+)"`)
	m := opfPathRE.FindStringSubmatch(string(containerOut))
	if len(m) < 2 {
		return
	}
	opfOut, err := exec.Command("unzip", "-p", path, m[1]).Output()
	if err != nil {
		return
	}
	opf := string(opfOut)
	title = firstXMLField(opf, "title")
	author = strings.Join(allXMLFields(opf, "creator"), ", ")
	description = firstXMLField(opf, "description")
	if dateStr := firstXMLField(opf, "date"); dateStr != "" {
		if ym := yearRegex.FindString(dateStr); ym != "" {
			if y, err := strconv.Atoi(ym); err == nil && y >= 1900 && y <= 2030 {
				year = y
			}
		}
	}
	return
}

// guessPurpose infers a human-facing "why I have this" label from metadata.
func guessPurpose(title, category, tags, description, filename string) string {
	combined := strings.ToLower(title + " " + category + " " + tags + " " + description + " " + filename)
	switch {
	case strings.Contains(combined, "interview") || strings.Contains(combined, "leetcode"):
		return "interview-prep"
	case strings.Contains(combined, "reference") || strings.Contains(combined, "handbook") || strings.Contains(combined, "documentation"):
		return "reference"
	case category == "research" || strings.Contains(combined, "survey") || arxivID.MatchString(filename):
		return "research"
	case strings.Contains(combined, "thesis"):
		return "academic"
	case strings.Contains(combined, "textbook") || strings.Contains(combined, "introduction") || strings.Contains(combined, "course"):
		return "learning"
	case strings.Contains(combined, "cookbook") || strings.Contains(combined, "practical") || strings.Contains(combined, "hands-on"):
		return "practice"
	case strings.Contains(combined, "self help") || strings.Contains(combined, "productivity") || strings.Contains(combined, "habit"):
		return "self-improvement"
	}
	return "reading"
}

func extractTitle(filename string) string {
	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	title = zlibrarySK.ReplaceAllString(title, "")
	title = zlibOrg.ReplaceAllString(title, "")
	title = oneLibSK.ReplaceAllString(title, "")
	title = zlibraryCap.ReplaceAllString(title, "")
	title = trailingNums.ReplaceAllString(title, "")

	title = parens.ReplaceAllString(title, "")
	title = cleanTitle.ReplaceAllString(title, " ")
	title = whitespace.ReplaceAllString(title, " ")
	return strings.TrimSpace(title)
}

// titleCaseFilename is the last-resort fallback: turns a filename like
// "reverse_engineering_x64.pdf" into "Reverse Engineering X 64".
// It title-cases words, replaces separators with spaces, and strips extensions.
func titleCaseFilename(filename string) string {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	name = strings.NewReplacer("_", " ", "-", " ", ".", " ").Replace(name)
	words := strings.Fields(name)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
		}
	}
	result := strings.Join(words, " ")
	if len(result) < 5 {
		result = "Untitled - " + filename
	}
	return result
}

func extractAuthors(filename string) string {
	matches := authorRegex.FindAllStringSubmatch(filename, -1)
	if len(matches) > 0 {
		authors := []string{}
		for _, m := range matches {
			candidate := m[1]
			if !strings.Contains(candidate, ".") && len(candidate) > 3 {
				authors = append(authors, candidate)
			}
		}
		if len(authors) > 0 {
			return strings.Join(authors, ", ")
		}
	}
	return ""
}

func extractYear(filename string) int {
	matches := yearRegex.FindAllString(filename, -1)
	for _, m := range matches {
		year, err := strconv.Atoi(m)
		if err == nil && year >= 1900 && year <= 2030 {
			return year
		}
	}
	return 0
}

var arxivID = regexp.MustCompile(`\d{4}\.\d{4,}(v\d+)?`)

func guessType(path, filename string) models.BookType {
	lowerPath := strings.ToLower(path)
	if strings.Contains(lowerPath, string(filepath.Separator)+"papers"+string(filepath.Separator)) {
		return models.TypePaper
	}
	if arxivID.MatchString(filename) {
		return models.TypePaper
	}
	return models.TypeBook
}

func wordBoundaryPattern(p string) *regexp.Regexp {
	escaped := regexp.QuoteMeta(p)
	return regexp.MustCompile(`\b` + escaped + `\b`)
}

func guessCategory(path, filename string) string {
	lowerPath := strings.ToLower(path)
	lowerFilename := strings.ToLower(filename)

	normalisedPath := strings.ReplaceAll(lowerPath, "-", " ")
	normalisedFilename := strings.ReplaceAll(lowerFilename, "-", " ")

	categoryRules := []struct {
		patterns []string
		category string
	}{
		{[]string{"thesis"}, "thesis"},
		{[]string{"papers", "research"}, "research"},
		{[]string{"interview", "leetcode", "dsa", "coding interview"}, "interview-prep"},
		{[]string{"system design", "architecture", "distributed system"}, "system-design"},
		{[]string{"machine learning", "deep learning", "neural", "artificial intelligence", "ai", "llm", "large language model", "transformer", "gpt", "natural language processing", "nlp", "computer vision"}, "machine-learning"},
		{[]string{"compiler", "interpreters", "programming language", "parser"}, "compilers"},
		{[]string{"operating system", "linux kernel", "os"}, "systems"},
		{[]string{"network", "tcp", "http", "protocol"}, "networking"},
		{[]string{"database", "sql", "postgresql", "nosql", "redis", "mongodb"}, "databases"},
		{[]string{"python"}, "python"},
		{[]string{"javascript", "react", "vue", "typescript", "node", "web", "css", "html"}, "web-dev"},
		{[]string{"golang", "go", "goroutine"}, "go"},
		{[]string{"docker", "kubernetes", "devops", "ci cd", "terraform", "ansible"}, "devops"},
		{[]string{"algorithm", "data structure"}, "algorithms"},
		{[]string{"security", "crypto", "cryptography", "cybersecurity", "vulnerability", "penetration"}, "security"},
		{[]string{"design pattern", "software design", "clean code", "refactoring"}, "software-design"},
		{[]string{"agile", "project management", "scrum"}, "management"},
		{[]string{"math", "numerical", "geometry", "statistics", "linear algebra", "calculus"}, "mathematics"},
		{[]string{"physics", "quantum", "mechanics", "thermodynamics"}, "physics"},
		{[]string{"biology", "genetics", "neuroscience", "evolution"}, "biology"},
		{[]string{"philosophy", "african", "nkrumah", "pan african"}, "philosophy"},
		{[]string{"history", "historical", "ancient", "medieval"}, "history"},
		{[]string{"economics", "finance", "investing", "stock", "trading"}, "economics"},
		{[]string{"stoic", "ethics"}, "philosophy"},
		{[]string{"self help", "productivity", "habit", "mindfulness"}, "self-help"},
		{[]string{"fiction", "novel", "science fiction", "fantasy"}, "fiction"},
	}

	for _, rule := range categoryRules {
		for _, p := range rule.patterns {
			re := wordBoundaryPattern(p)
			if re.MatchString(normalisedPath) || re.MatchString(normalisedFilename) {
				return rule.category
			}
		}
	}

	return ""
}

func guessTags(path, filename string) string {
	lower := strings.ToLower(filename + " " + path)
	var tags []string

	tagMap := map[string]string{
		"textbook":     "textbook",
		"cookbook":     "cookbook",
		"guide":        "guide",
		"handbook":     "handbook",
		"tutorial":     "tutorial",
		"interview":    "interview",
		"reference":    "reference",
		"beginner":     "beginner",
		"advanced":     "advanced",
		"practical":    "practical",
		"theory":       "theory",
		"case study":   "case-study",
		"real-world":   "real-world",
		"production":   "production",
		"classic":      "classic",
		"foundational": "foundational",
		"survey":       "survey",
		"introduction": "introductory",
		"complete":     "comprehensive",
		"modern":       "modern",
	}

	for keyword, tag := range tagMap {
		if strings.Contains(lower, keyword) {
			tags = append(tags, tag)
		}
	}

	if strings.Contains(lower, "z-library") || strings.Contains(lower, "z-lib") {
		tags = append(tags, "ebook-download")
	}

	return strings.Join(tags, ",")
}
