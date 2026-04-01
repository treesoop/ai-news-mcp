#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_BIN="/Users/potenlab/.local/bin/claude"
LOG_FILE="$SCRIPT_DIR/news_fetcher.log"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

# Load env
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
else
  echo "ERROR: .env not found" | tee -a "$LOG_FILE"
  exit 1
fi

echo "=== News fetch started at $(date) ===" | tee -a "$LOG_FILE"

"$CLAUDE_BIN" --dangerously-skip-permissions -p "$(cat "$SCRIPT_DIR/news_fetcher_prompt.md")" \
  --allowedTools "Bash,WebFetch,WebSearch" \
  2>&1 | tee -a "$LOG_FILE"

echo "=== Done at $(date) ===" | tee -a "$LOG_FILE"
