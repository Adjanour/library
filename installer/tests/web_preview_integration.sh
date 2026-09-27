#!/usr/bin/env bash
set -euo pipefail

installer_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/runtime" "$tmp_dir/app/deno/src" "$tmp_dir/app/web/static"
printf '#!/bin/sh\nexit 0\n' > "$tmp_dir/runtime/deno"
printf 'console.log("fixture")\n' > "$tmp_dir/app/deno/src/main.ts"
printf '{"version":"5","specifiers":{}}\n' > "$tmp_dir/app/deno/deno.lock"
printf '<!doctype html><title>Library fixture</title>\n' > "$tmp_dir/app/web/static/index.html"
(cd "$tmp_dir/runtime" && zip -q "$tmp_dir/deno.zip" deno)
(cd "$tmp_dir/app" && zip -qr "$tmp_dir/web.zip" .)

runtime_sha=$(sha256sum "$tmp_dir/deno.zip" | cut -d' ' -f1)
runtime_size=$(stat -c '%s' "$tmp_dir/deno.zip")
web_sha=$(sha256sum "$tmp_dir/web.zip" | cut -d' ' -f1)
web_size=$(stat -c '%s' "$tmp_dir/web.zip")

python3 - "$tmp_dir/payload.json" "$tmp_dir/web.zip" "$web_sha" "$web_size" "$tmp_dir/deno.zip" "$runtime_sha" "$runtime_size" <<'PY'
import json
import pathlib
import sys

output, web_path, web_sha, web_size, runtime_path, runtime_sha, runtime_size = sys.argv[1:]
payload = {
    "schema": 1,
    "channel": "test",
    "generated_at": "2026-09-27T00:00:00Z",
    "packages": [
        {
            "id": "web_preview",
            "display_name": "Library Web Preview",
            "version": "0.1.1-test",
            "license": "MIT",
            "source_url": "https://example.invalid/library",
            "optional": False,
            "artifacts": [{
                "os": "linux", "arch": "x86_64", "url": pathlib.Path(web_path).as_uri(),
                "sha256": web_sha, "size": int(web_size), "kind": "portable_zip"
            }],
        },
        {
            "id": "deno",
            "display_name": "Deno Runtime",
            "version": "2.9.6-test",
            "license": "MIT",
            "source_url": "https://example.invalid/deno",
            "optional": False,
            "artifacts": [{
                "os": "linux", "arch": "x86_64", "url": pathlib.Path(runtime_path).as_uri(),
                "sha256": runtime_sha, "size": int(runtime_size), "kind": "portable_zip"
            }],
        },
    ],
}
pathlib.Path(output).write_text(json.dumps(payload), encoding="utf-8")
PY

seed=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
(cd "$installer_dir" && mise exec -- zig build run -- sign-manifest "$tmp_dir/payload.json" "$tmp_dir/manifest.signed" "$seed")
(cd "$installer_dir" && mise exec -- zig build run -- install-web "$tmp_dir/manifest.signed" --root "$tmp_dir/install")

test -x "$tmp_dir/install/runtime/deno/versions/2.9.6-test/deno"
test -f "$tmp_dir/install/web-preview/versions/0.1.1-test/deno/src/main.ts"
test -x "$tmp_dir/install/web-preview/bin/library-web-preview"
grep -q '0.1.1-test' "$tmp_dir/install/web-preview/current.txt"
grep -q '2.9.6-test' "$tmp_dir/install/runtime/deno/current.txt"

echo "web preview integration passed: runtime, app, cache, pointers, launcher"
