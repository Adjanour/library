#!/usr/bin/env bash
set -euo pipefail

base_manifest=${1:?base manifest path required}
output_manifest=${2:?output manifest path required}
release_base=${3:?release base URL required}
version=$(jq -r '.packages[] | select(.id == "web_preview") | .version' "$base_manifest")
test "$version" != "null"

artifact_json() {
  local name=$1
  local os=$2
  local arch=$3
  local kind=$4
  local digest size

  test -f "$name"
  test -f "$name.sha256"
  digest=$(awk '{print $1}' "$name.sha256")
  size=$(wc -c < "$name" | tr -d '[:space:]')
  [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]]
  [[ "$size" =~ ^[0-9]+$ ]]

  jq -cn \
    --arg os "$os" \
    --arg arch "$arch" \
    --arg url "$release_base/$name" \
    --arg sha256 "$digest" \
    --argjson size "$size" \
    --arg kind "$kind" \
    '{os:$os,arch:$arch,url:$url,sha256:$sha256,size:$size,kind:$kind}'
}

linux=$(artifact_json library-desktop-linux-x86_64.tar.gz linux x86_64 tar_gz)
windows=$(artifact_json library-desktop-windows-x86_64.zip windows x86_64 portable_zip)
macos_x86_64=$(artifact_json library-desktop-macos-x86_64.zip macos x86_64 portable_zip)
macos_aarch64=$(artifact_json library-desktop-macos-aarch64.zip macos aarch64 portable_zip)

jq \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg version "$version" \
  --argjson linux "$linux" \
  --argjson windows "$windows" \
  --argjson macos_x86_64 "$macos_x86_64" \
  --argjson macos_aarch64 "$macos_aarch64" \
  '.generated_at = $generated_at
   | .packages = ([.packages[] | select(.id != "library_desktop")] + [{
       id: "library_desktop",
       display_name: "Library Desktop Preview",
       version: $version,
       license: "MIT",
       source_url: "https://github.com/Adjanour/library",
       optional: false,
       artifacts: [$linux, $windows, $macos_x86_64, $macos_aarch64]
     }])' \
  "$base_manifest" > "$output_manifest"

jq -e '.packages[] | select(.id == "library_desktop") | (.artifacts | length == 4)' "$output_manifest" >/dev/null
