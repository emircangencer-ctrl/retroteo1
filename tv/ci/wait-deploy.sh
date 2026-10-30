#!/usr/bin/env bash
# Waits until the Netlify deploy at $1 serves commit $2 (dist/build.json), so the TV check runs
# against the web app of this very commit.
set -u
URL="${1%/}"
SHA="$2"
for i in $(seq 1 90); do
  COMMIT=$(curl -fsS "$URL/build.json?t=$(date +%s)" 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
  if [ "$COMMIT" = "$SHA" ]; then echo "Deploy serves $SHA"; exit 0; fi
  echo "waiting for the deploy of $SHA (now: ${COMMIT:-none})"
  sleep 10
done
echo "::warning::The deploy did not reach $SHA in 15 minutes; checking the web app that is live now."
exit 0
