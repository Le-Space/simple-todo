// The pictures that go with this language's film, into <out dir>:
//
//   escrow01-<lang>-thumb.png    YouTube's thumbnail: the scene card, still,
//                                1920×1080 (the kit's thumbnail)
//   escrow01-<lang>.jpg          the player's poster in the start dialog, the
//                                same picture at the film's size (1920×1080)
//   escrow01-<lang>-teaser.png   the teaser's own picture, 96×54 for a 48×27
//                                spot on a 2× screen: no text, which would
//                                not survive that size, only a dark ▶ on
//                                Le Space's coral
//
//   node e2e-video/posters.mjs <out dir>                 # English
//   DEMO_LANG=de node e2e-video/posters.mjs <out dir>    # German
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { thumbnails } from '@le-space/video-kit/thumbnail';
import { BRAND, cards, LANG } from './escrow01.js';

const [outArg] = process.argv.slice(2);
if (!outArg) {
	console.error('usage: node e2e-video/posters.mjs <out dir>');
	process.exit(1);
}
const out = resolve(outArg);
const id = `escrow01-${LANG}`;
const film = fileURLToPath(new URL(`./films/${LANG}/${id}.json`, import.meta.url));

await thumbnails({ out, films: [film], cards });
execFileSync('ffmpeg', [
	'-loglevel',
	'error',
	'-y',
	'-i',
	resolve(out, `${id}-thumb.png`),
	'-q:v',
	'3',
	resolve(out, `${id}.jpg`)
]);
console.log(`${id}: ${resolve(out, `${id}.jpg`)}`);

const { accent, night } = BRAND.palette;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 96, height: 54 } });
await page.setContent(`<!doctype html><html><body style="margin:0;width:96px;height:54px;background:${accent};display:grid;place-items:center">
<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path d="M3 2.5 L28 17 L3 31.5 Z" fill="${night}" stroke="${night}" stroke-width="3" stroke-linejoin="round"/></svg>
</body></html>`);
const teaser = resolve(out, `${id}-teaser.png`);
await page.screenshot({ path: teaser });
await browser.close();
console.log(`${id}: ${teaser}`);
