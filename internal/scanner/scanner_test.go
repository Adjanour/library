package scanner

import (
	"testing"
)

func TestExtractTitle(t *testing.T) {
	tests := []struct {
		filename string
		want     string
	}{
		{"The Go Programming Language.pdf", "The Go Programming Language"},
		{"Design Patterns (Gang of Four).pdf", "Design Patterns"},
		{"book_with_underscores.pdf", "book with underscores"},
		{"Clean Code - A Handbook.pdf", "Clean Code A Handbook"},
		{"test (z-library.sk).pdf", "test"},
		{"test (123).pdf", "test"},
		{"  spaced  out  .pdf", "spaced out"},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := extractTitle(tt.filename)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractAuthors(t *testing.T) {
	tests := []struct {
		filename string
		want     string
	}{
		{"test (Author Name).pdf", "Author Name"},
		{"book (John) and (Jane).pdf", "John, Jane"},
		{"no parens.pdf", ""},
		{"short (AB).pdf", ""},
		{"has dots (A. B.).pdf", ""},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := extractAuthors(tt.filename)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractYear(t *testing.T) {
	tests := []struct {
		filename string
		want     int
	}{
		{"book 2020.pdf", 2020},
		{"paper 1999.pdf", 1999},
		{"no year.pdf", 0},
		{"invalid 1800.pdf", 0},
		{"future 2050.pdf", 0},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := extractYear(tt.filename)
			if got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestGuessCategory(t *testing.T) {
	tests := []struct {
		path     string
		filename string
		want     string
	}{
		{"/home/docs/thesis/final.pdf", "thesis.pdf", "thesis"},
		{"/home/docs/papers/research.pdf", "paper.pdf", "research"},
		{"/home/docs/leetcode.pdf", "leetcode.pdf", "interview-prep"},
		{"/home/docs/machine-learning.pdf", "ml.pdf", "machine-learning"},
		{"/home/docs/docker-compose.pdf", "docker-guide.pdf", "devops"},
		{"/home/docs/random.pdf", "random.pdf", ""},
		{"/home/docs/African Philosophy.pdf", "nkrumah.pdf", "philosophy"},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := guessCategory(tt.path, tt.filename)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGuessTags(t *testing.T) {
	tests := []struct {
		path     string
		filename string
		want     string
	}{
		{"textbook.pdf", "textbook.pdf", "textbook"},
		{"guide.pdf", "guide.pdf", "guide"},
		{"advanced topics.pdf", "advanced.pdf", "advanced"},
		{"no-tags.pdf", "no-tags.pdf", ""},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := guessTags(tt.path, tt.filename)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCleanTitleRegex(t *testing.T) {
	result := cleanTitle.ReplaceAllString("hello_world-test,file.name", " ")
	if result != "hello world test file name" {
		t.Errorf("cleanTitle regex produced %q", result)
	}
}
