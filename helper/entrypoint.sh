#!/bin/sh
# Container start: check the token, update yt-dlp (sites change often), keep it updated daily, start the helper.
set -e
if [ -z "$HELPER_TOKEN" ]; then
  echo "HELPER_TOKEN is not set. Copy .env.example to .env and set a long random token." >&2
  exit 1
fi
yt-dlp -U || echo "yt-dlp update check failed; using the installed version."
( while sleep 86400; do yt-dlp -U >/dev/null 2>&1 || true; done ) &
exec node /app/server.mjs
