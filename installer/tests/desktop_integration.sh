#!/usr/bin/env bash
set -euo pipefail

installer_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d)
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

mkdir -p "$tmp_dir/app/app"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$tmp_dir/app/app/app"
chmod +x "$tmp_dir/app/app/app"
(cd "$tmp_dir/app" && tar -czf "$tmp_dir/library-desktop.tar.gz" app)

desktop_sha=$(sha256sum "$tmp_dir/library-desktop.tar.gz" | cut -d' ' -f1)
desktop_size=$(stat -c '%s' "$tmp_dir/library-desktop.tar.gz")

python3 - "$tmp_dir/payload.json" "$tmp_dir/library-desktop.tar.gz" "$desktop_sha" "$desktop_size" <<'PY'
import json
import pathlib
import sys

output, archive_path, archive_sha, archive_size = sys.argv[1:]
payload = {
    "schema": 1,
    "channel": "test",
    "generated_at": "2026-09-27T00:00:00Z",
    "packages": [{
        "id": "library_desktop",
        "display_name": "Library Desktop Preview",
        "version": "0.1.1-test",
        "license": "MIT",
        "source_url": "https://example.invalid/library",
        "optional": False,
        "artifacts": [{
            "os": "linux", "arch": "x86_64", "url": pathlib.Path(archive_path).as_uri(),
            "sha256": archive_sha, "size": int(archive_size), "kind": "tar_gz"
        }],
    }],
}
pathlib.Path(output).write_text(json.dumps(payload), encoding="utf-8")
PY

seed=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
(cd "$installer_dir" && mise exec -- zig build run -- sign-manifest "$tmp_dir/payload.json" "$tmp_dir/manifest.signed" "$seed")
(cd "$installer_dir" && mise exec -- zig build run -- install-desktop "$tmp_dir/manifest.signed" --root "$tmp_dir/install")

test -x "$tmp_dir/install/desktop/versions/0.1.1-test/app/app"
test -x "$tmp_dir/install/desktop/bin/library"
grep -q '0.1.1-test' "$tmp_dir/install/desktop/current.txt"
test -f "$tmp_dir/install/desktop/versions/0.1.1-test/receipt.txt"

echo "desktop integration passed: archive, checksum, pointer, receipt, launcher"
