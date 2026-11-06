#!/bin/bash
# Builds the Next.js standalone server locally and assembles the Hostinger upload folder.
#   bash scripts/hostinger/package-standalone.sh [upload-dir]      (default: tmp/hostinger-deploy)
# Hostinger's build host cannot load Next's native SWC (old glibc) and its packer drops every folder named node_modules,
# so the app is built here and dependencies ship as nm_ (relocate-node-modules.cjs links them back when the server starts).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
upload="${1:-$root/tmp/hostinger-deploy}"
cd "$root/web"
HIMS_STANDALONE=1 npm run build > "$root/tmp/standalone-build.log" 2>&1 || { tail -30 "$root/tmp/standalone-build.log"; exit 1; }
rm -rf "$upload/.next" && mkdir -p "$upload/.next"
cp -r .next/standalone "$upload/.next/standalone" 2>/dev/null || true   # the externals alias below is a symlink Windows cannot copy
standalone="$upload/.next/standalone"
mkdir -p "$standalone/.next/node_modules/@react-pdf"
cp -r .next/standalone/node_modules/@react-pdf/renderer "$standalone/.next/node_modules/@react-pdf/renderer-$(ls .next/standalone/.next/node_modules/@react-pdf | sed 's/^renderer-//')"
cp -r .next/static "$standalone/.next/static" && cp -r public "$standalone/public"
node "$root/scripts/hostinger/relocate-node-modules.cjs" "$standalone"
echo "Upload folder ready: $upload (deploy with: hostinger up <folder> --domain <domain> --type nodejs --app-type next --node-version 24 --package-manager npm --build-script build --yes)"
