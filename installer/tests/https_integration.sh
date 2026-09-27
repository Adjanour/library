#!/usr/bin/env bash
set -euo pipefail

installer_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp_dir=$(mktemp -d)
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

python3 - "$tmp_dir/port" "$installer_dir/fixtures/library-artifact.bin" 2>"$tmp_dir/server.log" <<'PY' &
import http.server
import pathlib
import sys

port_file, artifact = sys.argv[1:]
body = pathlib.Path(artifact).read_bytes()
attempts = 0

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global attempts
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/artifact")
            self.end_headers()
            return
        if self.path == "/retry":
            attempts += 1
            if attempts == 1:
                self.send_response(503)
                self.end_headers()
                self.wfile.write(b"retry")
                return
        if self.path in ("/artifact", "/retry", "/oversized", "/checksum"):
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *_args):
        pass

server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
pathlib.Path(port_file).write_text(str(server.server_port))
server.serve_forever()
PY
server_pid=$!
for _ in $(seq 1 50); do [[ -s "$tmp_dir/port" ]] && break; sleep 0.1; done
if [[ ! -s "$tmp_dir/port" ]]; then
  echo "download fixture failed to start" >&2
  cat "$tmp_dir/server.log" >&2 || true
  exit 1
fi
port=$(<"$tmp_dir/port")

seed=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
run_case() {
  local name=$1
  local endpoint=$2
  local root="$tmp_dir/install-$name"
  sed "s#file:///home/bernard/library/installer/fixtures/library-artifact.bin#http://localhost:$port/$endpoint#" \
    "$installer_dir/fixtures/payload.json" > "$tmp_dir/$name.json"
  (cd "$installer_dir" && mise exec -- zig build run -- sign-manifest "$tmp_dir/$name.json" "$tmp_dir/$name.signed" "$seed")
  (cd "$installer_dir" && mise exec -- zig build run -- install "$tmp_dir/$name.signed" --root "$root" --allow-http)
  test -f "$root/library/versions/0.1.1-test/library-artifact"
}

run_case success artifact
run_case redirect redirect
run_case retry retry

sed "s#file:///home/bernard/library/installer/fixtures/library-artifact.bin#http://localhost:$port/oversized#; s#\"size\": 22#\"size\": 20#" \
  "$installer_dir/fixtures/payload.json" > "$tmp_dir/oversized.json"
(cd "$installer_dir" && mise exec -- zig build run -- sign-manifest "$tmp_dir/oversized.json" "$tmp_dir/oversized.signed" "$seed")
if (cd "$installer_dir" && mise exec -- zig build run -- install "$tmp_dir/oversized.signed" --root "$tmp_dir/install-oversized" --allow-http); then
  echo "oversized artifact unexpectedly installed" >&2
  exit 1
fi

sed "s#file:///home/bernard/library/installer/fixtures/library-artifact.bin#http://localhost:$port/checksum#; s#1886bc6e4a1530bd0a8629fbdc08c7d7f878bbe85befe902c112de9411552a95#0000000000000000000000000000000000000000000000000000000000000000#" \
  "$installer_dir/fixtures/payload.json" > "$tmp_dir/checksum.json"
(cd "$installer_dir" && mise exec -- zig build run -- sign-manifest "$tmp_dir/checksum.json" "$tmp_dir/checksum.signed" "$seed")
if (cd "$installer_dir" && mise exec -- zig build run -- install "$tmp_dir/checksum.signed" --root "$tmp_dir/install-checksum" --allow-http); then
  echo "checksum mismatch unexpectedly installed" >&2
  exit 1
fi

echo "download integration passed: success, redirect, retry, size rejection, checksum rejection"
