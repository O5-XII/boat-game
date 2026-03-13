#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install Node.js LTS from https://nodejs.org and try again."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
  exit 1
fi

node launcher/tui.js
STATUS=$?
echo ""
read -n 1 -s -r -p "Press any key to close..."
echo ""
exit $STATUS
