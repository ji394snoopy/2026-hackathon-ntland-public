#!/usr/bin/env bash
#
# Tars up the project into claude-ocr-util.tar.gz, excluding .git,
# node_modules, build/output artifacts, logs, and editor/OS cruft.
#
# Usage: ./scripts/archive.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT=output/claude-ocr-util.tar.gz

mkdir -p output

tar \
  --exclude-vcs \
  --exclude=node_modules \
  --exclude=output \
  --exclude=dist \
  --exclude=build \
  --exclude='*.tsbuildinfo' \
  --exclude='*.log' \
  --exclude=.DS_Store \
  --exclude=.vscode \
  --exclude=.idea \
  --exclude='*.tar.gz' \
  --exclude=.env \
  --exclude=temp \
  -czf "$OUT" .

echo "Wrote $OUT"
