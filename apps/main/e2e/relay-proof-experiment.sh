#!/bin/bash
# The relay-proof experiment of Le-Space/simple-todo#64: the two proof modes,
# `sync` and `observe`, run alternately (ABBA) so that neither gets the
# machine's good or bad minutes alone. Each run writes e2e/results/relay-proof-*.json;
# relay-proof-summary.mjs adds them up.
#
#   E2E_RELAY_CLI_PATH=/path/to/orbitdb-relay/dist/cli.js e2e/relay-proof-experiment.sh [iterations]
#
# iterations defaults to 5: four runs each, twenty in all, ten per mode.
# E2E_RELAY_CLI_PATH must name a build of orbitdb-relay main at or after
# NiKrause/orbitdb-relay#60; the relay in node_modules predates it. Run it on
# an otherwise idle machine, one Playwright suite at a time.
set -u
cd "$(dirname "$0")/.." || exit 1
ITERATIONS=${1:-5}

if [ -z "${E2E_RELAY_CLI_PATH:-}" ] || [ ! -f "$E2E_RELAY_CLI_PATH" ]; then
	echo "E2E_RELAY_CLI_PATH must point at orbitdb-relay's dist/cli.js (main, after #60)." >&2
	exit 2
fi
# A suite started through a package script runs as `…/playwright/cli.js test`,
# not `playwright test`; the pattern takes both.
if pgrep -f "[p]laywright(/cli\.js)? test" > /dev/null; then
	echo "Another Playwright suite is running; the timings would not be worth keeping." >&2
	exit 2
fi

mkdir -p e2e/results
run() {
	local mode=$1 label=$2
	local log="e2e/results/relay-proof-$label-$mode.log"
	RELAY_PROOF_MODE=$mode BENCH_LABEL=$label pnpm exec playwright test -c playwright.relay-proof.config.js > "$log" 2>&1
	local rc=$?
	echo "$label $mode exit=$rc  $(grep -E '^todo [0-9]+:' "$log" | sed -E 's/alice chip ([a-z]+) after ([0-9-]+) ms.*bob got it after ([0-9-]+) ms.*/\1\/\2\/\3/' | tr '\n' ' ')"
}

# Labels carry the relay, so runs against a local and a public relay can be
# told apart in e2e/results/ by name as well as by content.
RELAY_LABEL=${E2E_RELAY_MODE:-local}
for i in $(seq 1 "$ITERATIONS"); do
	run observe "$RELAY_LABEL-abba$i-1"
	run sync "$RELAY_LABEL-abba$i-2"
	run sync "$RELAY_LABEL-abba$i-3"
	run observe "$RELAY_LABEL-abba$i-4"
done

node e2e/relay-proof-summary.mjs
