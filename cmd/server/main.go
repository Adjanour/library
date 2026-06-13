package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/bernard/library/internal/api"
	"github.com/bernard/library/internal/db"
	"github.com/bernard/library/internal/scanner"
)

func main() {
	port := flag.Int("port", 8080, "server port")
	scan := flag.Bool("scan", false, "scan and index files before starting")
	flag.Parse()

	homeDir, _ := os.UserHomeDir()
	dbPath := filepath.Join(homeDir, ".local", "share", "library", "library.db")

	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	if *scan {
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
			log.Printf("scan error: %v", err)
		}
		fmt.Printf("\nIndexed %d new items\n", indexed)
	}

	mux := http.NewServeMux()

	handler := api.NewHandler(database)
	handler.RegisterRoutes(mux)

	readingHandler := api.NewReadingHandler(database)
	readingHandler.RegisterRoutes(mux)

	staticDir := filepath.Join(homeDir, "library", "web", "static")
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = filepath.Join(filepath.Dir(os.Args[0]), "..", "web", "static")
	}
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))

	addr := fmt.Sprintf(":%d", *port)
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		fmt.Printf("Library server running at http://localhost%s\n", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-quit
	fmt.Println("\nShutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}

	fmt.Println("Server exited")
}
