// escrow01's side of its demo film: the Le Space brand on the title cards,
// the narrator, and the language of the recording. The kit itself is
// @le-space/video-kit (Le-Space/belege, packages/video-kit), linked by
// link-kit.sh until it is on npm.
//
// One language per run: DEMO_LANG=de records the German app, the German lines
// and the German cards. The closing card's address and QR follow the language,
// because the English link preview lives at /en/ and the German one at /.
import { fileURLToPath } from 'node:url';
import { createCards } from '@le-space/video-kit/card';
import { qrSvg } from '@le-space/video-kit/qr';
import { createVoice } from '@le-space/video-kit/voice';

export const LANG = process.env.DEMO_LANG === 'de' ? 'de' : 'en';

/** Where the film is shot: the live chapter unless DEMO_URL names another build. */
export const APP_URL = (process.env.DEMO_URL || 'https://escrow01.le-space.de/').replace(
	/\/?$/,
	'/'
);
/** The address the closing card shows and its QR opens, per language. */
export const SHARE_URL =
	LANG === 'de' ? 'https://escrow01.le-space.de/' : 'https://escrow01.le-space.de/en/';

/** Le Space's palette (Le-Space/landing, docs/le-space-brand), the app's own dark theme. */
export const NIGHT = '#0b0e15'; // Deep Space
const PALETTE = {
	night: NIGHT,
	panel: '#141926', // Nebula
	snow: '#edf1f8', // Starlight
	muted: '#a8b3c7', // Stardust
	accent: '#ff6b5b', // Signal Coral
	accent2: '#58c7f3', // Sync Cyan
	ink: '#0b0e15',
	line: '#232b3d' // Horizon
};

/**
 * "Alice", one of ElevenLabs' premade voices, as in Belege's film of #961.
 * ELEVENLABS_VOICE_ID still overrides it; DEMO_VOICE=say is a dry run with
 * macOS's voice, DEMO_VOICE=none records silence.
 */
const ALICE = 'Xb7hH8MSUJpSbSDYk0k2';

/**
 * The narrator. Spoken lines are kept in e2e-video/voice/ (not in git). Eleven
 * v4 reads IPA between slashes: the chapter's name and the token are said as
 * a person says them; captions keep the written word.
 */
export const voice = createVoice({
	dir: fileURLToPath(new URL('./voice/', import.meta.url)),
	voiceId: process.env.ELEVENLABS_VOICE_ID || ALICE,
	pronounce: {
		escrow01: '/ˈɛskroʊ ˈzɪəroʊ wʌn/',
		cUSDT: '/siː juː ɛs diː tiː/'
	}
});

// Le Space's mark, "the first node" (packages/brand/static/le-space-mark.svg):
// the coral local node settles in, then the cyan peers and their links draw
// themselves.
const MARK = (
	/** @type {string} */ cls = ''
) => `<svg class="mark ${cls}" viewBox="0 0 96 96" aria-hidden="true">
  <line class="link" x1="42.7" y1="49.96" x2="58.56" y2="34.94" stroke="#58C7F3" stroke-width="4" stroke-linecap="round" pathLength="100"/>
  <line class="link dots" x1="47.43" y1="63.58" x2="62.8" y2="64.98" stroke="#58C7F3" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.1 8"/>
  <line class="link dots faint" x1="69.85" y1="38.36" x2="72.41" y2="55.37" stroke="#58C7F3" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0.1 6"/>
  <circle class="node" cx="30" cy="62" r="15" fill="#FF6B5B"/>
  <circle class="peer" cx="68" cy="26" r="8" fill="none" stroke="#58C7F3" stroke-width="5"/>
  <circle class="peer late" cx="74" cy="66" r="6.5" fill="none" stroke="#58C7F3" stroke-width="4.5"/>
  <circle class="peer later" cx="17" cy="21" r="2.6" fill="#58C7F3"/>
</svg>`;

/** @type {string | null} */
let qr = null;

/** @type {import('@le-space/video-kit/card').Brand} */
export const BRAND = {
	name: 'Le Space escrow01',
	introTitle: 'escrow01',
	mark: MARK,
	// Le Space's wordmark is set in JetBrains Mono; the system's monospace is the
	// nearest face that needs no download.
	words: `<span class="words" aria-hidden="true"><span class="prefix">LE SPACE</span><span class="name">escrow01</span></span>`,
	css: `.words { font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; }
.mark .node { transform-box: fill-box; transform-origin: center; transform: scale(0); }
.mark .peer, .mark .link { opacity: 0; }
.mark .faint { opacity: 0; }
.go .mark .node { animation: pop 520ms cubic-bezier(.2,.9,.3,1.2) 150ms forwards; }
.go .mark .peer { animation: show 380ms ease-out 620ms forwards; }
.go .mark .peer.late { animation-delay: 820ms; }
.go .mark .peer.later { animation: dim 380ms ease-out 1000ms forwards; }
.go .mark .link { animation: show 420ms ease-out 900ms forwards; }
.go .mark .link.faint { animation: dimmer 420ms ease-out 1100ms forwards; }
@keyframes pop { to { transform: scale(1); } }
@keyframes show { to { opacity: 1; } }
@keyframes dim { to { opacity: .55; } }
@keyframes dimmer { to { opacity: .65; } }
`,
	stillCss:
		'.scene .mark .node{transform:none;animation:none}.scene .mark .peer,.scene .mark .link{opacity:1;animation:none}.scene .mark .peer.later{opacity:.55}.scene .mark .link.faint{opacity:.65}',
	palette: PALETTE,
	font: null,
	site: SHARE_URL.replace(/^https:\/\//, '').replace(/\/$/, ''),
	// Made on first use: qrencode runs only where a closing card is drawn.
	get qr() {
		return (qr ??= qrSvg(SHARE_URL, { ink: PALETTE.ink }));
	},
	texts: {
		en: {
			tagline: 'Confidential payments by passkey.',
			introSay: 'Le Space escrow01. Confidential payments by passkey.',
			scene: 'Scene',
			facts: [
				'Runs in the browser: no accounts, no passwords',
				'Amounts encrypted with Zama FHE (ERC-7984)',
				'Open source, MIT · Sepolia testnet'
			],
			outroSay:
				'escrow01 by Le Space. Try it at escrow01 dot le-space dot de. Building passkey wallets, confidential payments or local-first apps? Let’s talk.',
			scan: 'Scan to open the demo'
		},
		de: {
			tagline: 'Vertrauliche Zahlungen per Passkey.',
			introSay: 'Le Space escrow01. Vertrauliche Zahlungen per Passkey.',
			scene: 'Szene',
			facts: [
				'Läuft im Browser: keine Konten, keine Passwörter',
				'Beträge verschlüsselt mit Zama FHE (ERC-7984)',
				'Open Source, MIT · Sepolia-Testnetz'
			],
			outroSay:
				'escrow01 von Le Space. Zum Ausprobieren unter escrow01 Punkt le-space Punkt de. Sie brauchen Passkey-Wallets, vertrauliche Zahlungen oder Local-first-Apps? Sprechen wir darüber.',
			scan: 'Scannen und die Demo öffnen'
		}
	}
};

export const cards = createCards(BRAND);
