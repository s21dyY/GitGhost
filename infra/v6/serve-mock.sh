#!/usr/bin/env bash
# Start the production build on localhost with the SCRIPTED provider forced, whatever .env.local says.
# Shell variables win over .env.local, so no browser check run through this can ever reach Bedrock.
#   ./infra/v6/serve-mock.sh [port]      (default 3100; runs in the foreground, Ctrl-C to stop)
set -euo pipefail
cd "$(dirname "$0")/../.."
exec env GITGHOST_CHAT_PROVIDER=mock GITGHOST_BEDROCK_ENABLED=false GITGHOST_BEDROCK_KILL_SWITCH=true \
  SUMMON_PAGE_LIMIT=500 GITGHOST_CHAT_REQUESTS_PER_MINUTE=60 npx next start -p "${1:-3100}"
