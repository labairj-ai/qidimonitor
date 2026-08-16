#!/usr/bin/env bash
set -e

REMOTE="optiplex@192.168.1.178"
REMOTE_DIR="~/qidimonitor"

echo "==> Building client…"
npm run build

echo "==> Syncing to optiplex…"
rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.db' \
  --exclude 'snapshots' \
  ./ "$REMOTE:$REMOTE_DIR/"

echo "==> Installing server dependencies…"
ssh "$REMOTE" "cd $REMOTE_DIR && npm ci --omit=dev --workspace=server"

echo "==> Restarting service…"
ssh "$REMOTE" "sudo systemctl restart qidimonitor"

echo "==> Done! https://qidimonitor.tailb97cdb.ts.net/"
