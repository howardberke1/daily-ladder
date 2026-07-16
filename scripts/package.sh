#!/usr/bin/env bash
# Packages a versioned, deploy-ready zip (index.html at the root, so it can be
# dropped straight onto Netlify or dragged into GitHub).
#
#   bash scripts/package.sh
#
# Reads the version from js/version.js — bump it there, not here.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(grep -oP 'VERSION = "\K[^"]+' js/version.js)
OUT="daily-ladder-v${VERSION}.zip"

node scripts/puzzle.mjs validate
for f in js/*.js; do node --check "$f"; done

rm -f "../$OUT"
zip -rq "../$OUT" index.html css js data README.md scripts supabase
echo "✔ packaged ../$OUT"
