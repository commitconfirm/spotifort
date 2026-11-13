#!/usr/bin/env bash
# Run one pipeline stage (`npm run lineup:<stage>`) for the scheduled lineup job.
# On failure: put the stage name and the last lines of its output in the job summary, and exit non-zero.
# The log text comes from external APIs, so it is shown inside a code fence with fence characters defused,
# and lines that look like workflow commands (`::...`) are indented so the runner does not act on them.
set -uo pipefail

stage="${1:?usage: run-stage.sh <stage>}"
log="${RUNNER_TEMP:?}/stage-${stage}.log"

echo "::group::npm run lineup:${stage}"
npm run "lineup:${stage}" 2>&1 | sed -u 's/^::/ ::/' | tee "$log"
status=${PIPESTATUS[0]}
echo "::endgroup::"

if [ "$status" -ne 0 ]; then
  {
    echo "### Lineup pipeline failed at stage \`${stage}\` (exit ${status})"
    echo
    echo 'Last lines of its output. Nothing was pushed.'
    echo
    echo '````text'
    tail -n 40 "$log" | sed 's/````*/` ` `/g'
    echo '````'
  } >> "$GITHUB_STEP_SUMMARY"
  echo "::error title=Lineup stage failed::Stage '${stage}' exited with ${status}. See the job summary."
  exit "$status"
fi
