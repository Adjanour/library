package scanner

import (
	"testing"
)

func TestExtractTitleFromFirstPage(t *testing.T) {
	tests := []struct {
		name string
		text string
		want string
	}{
		{"title after arxiv marker", "arXiv:1706.03762v7 [cs.CL]\nAttention Is All You Need\nAshish Vaswani1\nABSTRACT", "Attention Is All You Need"},
		{"all-caps title after arxiv marker", "arXiv:2602.02734v2 [eess.AS] 4 Feb 2026\n\nWAXAL: A LARGE-SCALE MULTILINGUAL AFRICAN LANGUAGE SPEECH CORPUS\nAbdoulaye Diack1\nABSTRACT\nThe advancement of speech technology has predominantly favored high-resource languages", "WAXAL: A LARGE-SCALE MULTILINGUAL AFRICAN LANGUAGE SPEECH CORPUS"},
		{"ordinary first-page title", "\nCustomizing Mass Housing\nA thesis submitted to MIT\n", "Customizing Mass Housing"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractTitleFromText(tt.text)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestIsBadMetadata(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"", true},
		{"-", true},
		{"ab", true},
		{"Course name:", true},
		{"COURSE NAME:", true},
		{"718560464", true},
		{"Anonymous", true},
		{"Microsoft Word - foo", true},
		{"Grokking Algorithms", false},
		{"The Art of the Fugue", false},
		{"WAXAL: A LARGE-SCALE MULTILINGUAL AFRICAN LANGUAGE SPEECH CORPUS", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isBadMetadata(tt.input)
			if got != tt.want {
				t.Errorf("isBadMetadata(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
