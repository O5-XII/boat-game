#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js is not installed."
  echo "Install Node.js LTS from https://nodejs.org and try again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
  exit 1
fi

"$NODE_BIN" launcher/tui.js
STATUS=$?
echo ""
read -n 1 -s -r -p "Press any key to close..."
echo ""
exit $STATUS
