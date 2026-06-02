#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_BIN="/Users/potenlab/.local/bin/claude"
LOG_FILE="$SCRIPT_DIR/news_fetcher.log"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

# Isolated Claude config — no plugins, no hooks, no CLAUDE.md auto-discovery
# (vercel-plugin etc. otherwise hijack headless -p sessions with system reminders)
export CLAUDE_CONFIG_DIR="/tmp/fetcher-claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
ln -sf "$HOME/.claude/.credentials.json" "$CLAUDE_CONFIG_DIR/.credentials.json"

# Kill any prior hung instance of this script (older than 20 min)
for pid in $(pgrep -f "run_news_fetcher.sh" | grep -v "^$$\$"); do
  [ "$pid" = "$$" ] && continue
  etime=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
  if [ -n "$etime" ] && [ "$etime" -gt 1200 ]; then
    echo "Killing stale fetcher pid=$pid (etime=${etime}s)" | tee -a "$LOG_FILE"
    pkill -9 -P "$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  fi
done

# Kill orphaned claude processes tied to our prompts (>20min old)
for pid in $(pgrep -f "claude.*dangerously-skip-permissions.*-p" 2>/dev/null); do
  etime=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
  if [ -n "$etime" ] && [ "$etime" -gt 1200 ]; then
    # Only kill if it's an orphan (ppid=1) or parent is another stale fetcher
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ "$ppid" = "1" ]; then
      echo "Killing orphan claude pid=$pid (etime=${etime}s)" | tee -a "$LOG_FILE"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
done

# Portable timeout wrapper (macOS lacks `timeout`)
run_with_timeout() {
  local secs=$1; shift
  perl -e 'use POSIX; $s=shift; $p=fork; if($p==0){setpgrp;exec @ARGV;exit 127} $SIG{ALRM}=sub{kill -9,$p;exit 124}; alarm $s; waitpid $p,0; exit($?>>8)' "$secs" "$@"
}

# Load env
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
else
  echo "ERROR: .env not found" | tee -a "$LOG_FILE"
  exit 1
fi

echo "=== News fetch started at $(date) ===" | tee -a "$LOG_FILE"

# STEP 1: Scrape (Sonnet — cheap, mechanical) — 15min timeout
echo "--- Scraping with Sonnet ---" | tee -a "$LOG_FILE"
run_with_timeout 900 "$CLAUDE_BIN" --dangerously-skip-permissions -p "$(cat "$SCRIPT_DIR/news_fetcher_prompt.md")" \
  --allowedTools "Bash,WebFetch,WebSearch" \
  2>&1 | tee -a "$LOG_FILE" || echo "Scrape step exited $?" | tee -a "$LOG_FILE"

# STEP 2: Curate (Opus — quality judgment) — 10min timeout
echo "--- Curating with Opus ---" | tee -a "$LOG_FILE"
run_with_timeout 600 "$CLAUDE_BIN" --dangerously-skip-permissions --model claude-opus-4-6 -p "$(cat "$SCRIPT_DIR/news_curate_prompt.md")" \
  --allowedTools "Bash" \
  2>&1 | tee -a "$LOG_FILE" || echo "Curate step exited $?" | tee -a "$LOG_FILE"

echo "=== Done at $(date) ===" | tee -a "$LOG_FILE"
