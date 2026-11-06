#!/usr/bin/env bash
# Option 2 detail pyramid: public/tiles/satellite-6in/{19,20,21}
# Until a true 6" build exists, link those zooms to the overview pyramid.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/public/tiles/satellite"
DST="$ROOT/public/tiles/satellite-6in"
mkdir -p "$DST"
for z in 19 20 21; do
  if [[ ! -d "$SRC/$z" ]]; then
    echo "missing $SRC/$z — build overview tiles first" >&2
    exit 1
  fi
  ln -sfn "../satellite/$z" "$DST/$z"
done
echo "linked $DST/{19,20,21} -> ../satellite/{19,20,21}"
