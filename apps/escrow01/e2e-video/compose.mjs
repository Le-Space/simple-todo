// After a recording run: every result with its voice and subtitles into
// <out dir>, and with --film the film's cards and scene end to end (the kit's
// compose, on Le Space's night). Playwright wipes results/ on the next run, so
// compose at once.
//
//   node e2e-video/compose.mjs <out dir> [--film e2e-video/films/en/escrow01-en.json]
import { fileURLToPath } from 'node:url';
import { composeCli } from '@le-space/video-kit/compose';

composeCli(process.argv.slice(2), {
	results: fileURLToPath(new URL('./results/', import.meta.url)),
	night: '#0b0e15'
});
