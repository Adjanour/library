#!/bin/bash
# Dev server for library web UI with live reload
# Starts SvelteKit dev server on port 5173 with API proxy to :3000

cd "$(dirname "$0")/web/svelte"

echo "Starting SvelteKit dev server..."
echo "  UI:  http://localhost:5173"
echo "  API: http://localhost:3000 (proxy)"
echo ""

npm run dev -- --host 0.0.0.0
