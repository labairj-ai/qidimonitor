#!/usr/bin/env bash
set -e

echo "==> Building client…"
cd "$(dirname "$0")"
npm run build

echo "==> Restarting service…"
pm2 restart qidimonitor

echo "==> Done! https://ais-mac-mini.tailb97cdb.ts.net/"
