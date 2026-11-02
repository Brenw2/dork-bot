#!/usr/bin/env bash
# Restart the Hermes gateway (picks up the API server settings), then prove one
# streamed chat with a bot on Dork. Run from a normal terminal, not from inside Hermes.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Restarting the Hermes gateway..."
hermes gateway restart
node scripts/smoke-chat.mjs "${1:-assistant}" | tee "${TMPDIR:-/tmp}/dork-smoke.log"
