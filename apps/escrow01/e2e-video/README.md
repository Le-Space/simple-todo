# The demo film

escrow01's demo film, recorded by Playwright: Alice hands a task to Bob with a
budget locked in escrow, Bob does it, Alice pays out, and the auditor looks on.
Both browsers share one stage, with one narrator ("Alice", ElevenLabs) and
title cards in Le Space's brand. There are two versions, English and German.

It uses [`@le-space/video-kit`](https://github.com/Le-Space/belege/tree/main/packages/video-kit)
from Le-Space/belege, which is not on npm yet, together with belege's Playwright,
whose recorder is patched to keep text sharp. `pnpm video:link` links both from a
belege checkout (`BELEGE_DIR`, default `~/Projects/belege`).

| File                      | What it is                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `escrow01.spec.js`        | the stage: Alice and Bob, five chapters, lines in EN and DE                                   |
| `escrow01.js`             | the brand on the cards, the narrator, the language (`DEMO_LANG`) and the address (`DEMO_URL`) |
| `cards.spec.js`, `films/` | the title cards of `films/<lang>/`, and the film as a list of parts                           |
| `compose.mjs`             | voice, cuts, cards and scene into one MP4 with subtitles                                      |
| `posters.mjs`             | YouTube thumbnail, the player's poster, the 96×54 teaser picture                              |

## Recording

Record only while nothing else runs on this machine:

```bash
pgrep -fl "^[^ ]*(node|npm|pnpm)[^ ]* .*(playwright|vitest)"
```

```bash
pnpm video:link
DEMO_VOICE=say DEMO_URL=local pnpm video:film      # dry run: this checkout's E2E build, macOS voice
DEMO_RES=2160 pnpm video:cards                     # the real thing, English
pnpm video:compose e2e-video/out                   # the cards into out/, before the film run wipes results/
DEMO_RES=2160 pnpm video:film
pnpm video:compose e2e-video/out --film e2e-video/films/en/escrow01-en.json
pnpm video:posters e2e-video/out
```

Set `DEMO_LANG=de` on every step for the German version. Playwright clears
`results/` on its next run, so compose right after recording.

By default the film is shot against https://escrow01.le-space.de/. There the
budget service runs on Sepolia: amounts are really encrypted, and each run
creates two new passkey accounts. Setting them up, the lock and the release are
user operations whose gas Openfort sponsors. A dry run
with `DEMO_URL=local` uses the fake, which encrypts nothing, so it checks the
steps, not the chain.

## Into the app

The start dialog's teaser and the "Video" link in the header stay hidden until
[`src/lib/demo-video.js`](../src/lib/demo-video.js) has an entry for the
language on screen. Per language that takes:

- an MP4 in `src/lib/demo-video/`, imported by `demo-video.js` (not `static/`:
  that is `packages/brand/static`, which every chapter ships), 1080p H.264 and at most
  15 MB: it ships with the build that goes to IPFS and Aleph. The recording is
  made at 2160, so this file is a 1080p copy of it; YouTube gets the full size;
- a WebVTT file with the captions, which is not optional: an entry without one
  counts as none;
- the player's `poster`, and the 96×54 `thumb` for the teaser (`posters.mjs`
  writes both);
- `youtubeId` for the plain link beside the player, and `duration` as `m:ss`.

Vite gives the imported files hashed names and paths relative to the page, as
everything in this static build has. The
spec for the teaser and the player is `e2e/demo-video.spec.js`; it hands the
page entries of its own, so it runs before there is a film.
