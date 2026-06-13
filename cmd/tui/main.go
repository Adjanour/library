package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/scanner"
	"github.com/bernard/library/internal/tui"
)

func main() {
	scan := flag.Bool("scan", false, "scan and index files before starting")
	flag.Parse()

	homeDir, _ := os.UserHomeDir()
	dbPath := filepath.Join(homeDir, ".local", "share", "library", "library.db")

	database, err := db.New(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	if *scan {
		runScan(database, homeDir)
	}

	p := tea.NewProgram(tui.New(database), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func runScan(database *db.DB, homeDir string) {
	dirs := []string{
		filepath.Join(homeDir, "Documents"),
		filepath.Join(homeDir, "Downloads"),
	}

	sc := scanner.New(database, dirs)
	fmt.Println("Scanning for books and papers...")

	indexed, err := sc.ScanAll(func(current, total int, filename string) {
		fmt.Printf("\r[%d/%d] %s", current, total, filename)
	})
	if err != nil {
		fmt.Printf("\nscan error: %v\n", err)
		return
	}

	if indexed > 0 {
		fmt.Printf("\nIndexed %d new items\n", indexed)
	} else {
		fmt.Println("\nNo new files to index")
	}
}
