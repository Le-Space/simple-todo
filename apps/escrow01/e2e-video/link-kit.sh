#!/usr/bin/env bash
# The demo films use @le-space/video-kit and the Playwright that records text
# sharply (its 1 Mbit/s VP8 cap lifted by a patch). Both come from a checkout of
# Le-Space/belege: the kit is not on npm yet. This links them into
# e2e-video/node_modules, so that the film's specs, its config and the kit all
# load one and the same @playwright/test. A second copy makes Playwright refuse
# to run.
#
#   e2e-video/link-kit.sh                       # belege in ~/Projects/belege
#   BELEGE_DIR=/path/to/belege e2e-video/link-kit.sh
#
# The specs here therefore import nothing that imports @playwright/test from
# this repository (e2e/sections.mjs does; e2e-kit's consent.mjs and
# webauthn.mjs do not).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
belege="${BELEGE_DIR:-$HOME/Projects/belege}"
kit="$belege/packages/video-kit"

test -f "$kit/package.json" || {
	echo "No video kit at $kit. Set BELEGE_DIR to a checkout of Le-Space/belege." >&2
	exit 1
}
test -d "$belege/app/node_modules/@playwright/test" || {
	echo "belege has no @playwright/test installed. Run pnpm install in $belege first." >&2
	exit 1
}
playwright="$(cd "$belege/app/node_modules/@playwright/test" && pwd -P)"

# The patched playwright-core is what keeps text sharp; say so if it is missing.
if ! ls -d "$belege"/node_modules/.pnpm/playwright-core@*_patch_hash=* >/dev/null 2>&1; then
	echo "Warning: belege's playwright-core is not patched; the recording will smear text." >&2
fi

mkdir -p "$here/node_modules/@playwright" "$here/node_modules/@le-space"
ln -sfn "$playwright" "$here/node_modules/@playwright/test"
ln -sfn "$kit" "$here/node_modules/@le-space/video-kit"
echo "Linked @playwright/test -> $playwright"
echo "Linked @le-space/video-kit -> $kit"
