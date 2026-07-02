BIN_DIR := bin
SERVER_BIN := $(BIN_DIR)/server
TUI_BIN := $(BIN_DIR)/tui
ORGANIZE_BIN := $(BIN_DIR)/organize

.PHONY: all build build-server build-tui build-web test test-go test-ts clean

all: build test

build: build-web build-server build-tui build-organize

build-web:
	cd web/svelte && npm run build

build-organize:
	go build -o $(ORGANIZE_BIN) ./cmd/organize

build-server:
	go build -o $(SERVER_BIN) ./cmd/server

build-tui:
	go build -o $(TUI_BIN) ./cmd/tui

test: test-go test-ts

test-go:
	go test ./...

test-ts:
	cd web && npm test -- --run

clean:
	rm -f $(SERVER_BIN) $(TUI_BIN) $(ORGANIZE_BIN)
