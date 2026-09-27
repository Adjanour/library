#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=${1:-${LIBRARY_PORT:-8080}}

if ! command -v deno >/dev/null 2>&1; then
  echo "Library Web Preview needs Deno 2.9.6 or newer." >&2
  echo "Install Deno from https://deno.com/ and run this script again." >&2
  exit 1
fi

exec deno run --allow-all "$ROOT/deno/src/main.ts" "$PORT"
