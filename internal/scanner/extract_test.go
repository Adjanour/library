package scanner

import (
	"testing"
)

func TestExtractTitleFromFirstPage(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/home/bernard/Documents/Papers/1706.03762v7.pdf", "Attention Is All You Need"},
		{"/home/bernard/Documents/Papers/2201.03898v1.pdf", "An Introduction to Autoencoders"},
		{"/home/bernard/Documents/Papers/2402.06196v3.pdf", "Large Language Models: A Survey"},
		{"/home/bernard/Documents/Papers/2005.14165v4.pdf", "Language Models are Few-Shot Learners"},
		{"/home/bernard/Documents/Papers/785_StructLM_Towards_Building_.pdf", "StructLM: Towards Building Generalist Models for Structured"},
		{"/home/bernard/Documents/Papers/50059717-MIT.pdf", "Customizing Mass Housing"},
		{"/home/bernard/Documents/Papers/2602.02734v2.pdf", "WAXAL: A LARGE-SCALE MULTILINGUAL AFRICAN LANGUAGE SPEECH CORPUS"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := extractTitleFromFirstPage(tt.path)
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
