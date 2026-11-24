/**
 * escrow01's English link preview, at /en/.
 *
 * A link preview is whatever the page's own tags say: LinkedIn, X and the
 * messengers read the static HTML and run no JavaScript, so the language switch
 * in the app never reaches them. `app.html` speaks German — escrow01 went to a
 * German bank first — and LinkedIn has no setting for the language of a
 * preview. So the English preview is a page of its own: English tags, an English
 * card, and a redirect into the app with `?lang=en` for the person who clicks.
 *
 * Built here rather than dropped into the assets folder: every chapter shares
 * `packages/brand/static`, and an `en/index.html` there would turn up under /en/
 * on all ten domains.
 *
 * The redirect is a script, not `<meta http-equiv="refresh">`: some crawlers
 * follow a refresh and would read the German page it leads to.
 */
import { readFileSync } from 'node:fs';

/** The chapter's domain, from the same file the deploy reads it from. */
function chapterOrigin() {
	const chapter = JSON.parse(readFileSync(new URL('chapter.json', import.meta.url), 'utf8'));
	return `https://${chapter.aleph.domain}`;
}

const TITLE = 'Confidential escrow for delegated tasks';
const DESCRIPTION =
	'Alice hands a task to Bob and locks a budget whose amount stays encrypted (Zama FHE, ERC-7984). A passkey signs, the gas is sponsored. A demo on the Sepolia testnet.';
const IMAGE_ALT =
	'Confidential escrow: budget locked, amount encrypted, released by passkey. escrow01, Sepolia testnet.';

/**
 * @param {string} origin e.g. https://escrow01.le-space.de
 * @returns {string}
 */
export function englishPreviewPage(origin = chapterOrigin()) {
	const url = `${origin}/en/`;
	const image = `${origin}/og/escrow01-en.jpg`;
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${TITLE} · escrow01</title>
		<meta name="description" content="Demo: ${DESCRIPTION}" />
		<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
		<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
		<meta name="theme-color" content="#0B0E15" />

		<!-- Its own canonical and og:url: a preview that follows the canonical
		     (LinkedIn does) would otherwise fetch the German page at /. -->
		<link rel="canonical" href="${url}" />
		<link rel="alternate" hreflang="en" href="${url}" />
		<link rel="alternate" hreflang="de" href="${origin}/" />

		<meta property="og:type" content="website" />
		<meta property="og:url" content="${url}" />
		<meta property="og:title" content="${TITLE}" />
		<meta property="og:description" content="${DESCRIPTION}" />
		<meta property="og:image" content="${image}" />
		<meta property="og:image:type" content="image/jpeg" />
		<meta property="og:image:alt" content="${IMAGE_ALT}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:site_name" content="Le Space" />
		<meta property="og:locale" content="en_US" />
		<meta property="og:locale:alternate" content="de_DE" />

		<meta property="twitter:card" content="summary_large_image" />
		<meta property="twitter:url" content="${url}" />
		<meta property="twitter:title" content="${TITLE}" />
		<meta property="twitter:description" content="${DESCRIPTION}" />
		<meta property="twitter:image" content="${image}" />
		<meta property="twitter:image:alt" content="${IMAGE_ALT}" />

		<meta name="robots" content="noindex, follow" />

		<script>
			location.replace('/?lang=en' + location.hash);
		</script>
		<style>
			body { margin: 0; min-height: 100vh; display: grid; place-items: center;
				background: #0b0e15; color: #edf1f8; font: 16px/1.5 system-ui, sans-serif; }
			a { color: #58c7f3; }
		</style>
	</head>
	<body>
		<p><a href="/?lang=en">Open the confidential escrow demo</a></p>
	</body>
</html>
`;
}

/**
 * Emits `en/index.html` into the client build. SvelteKit builds twice with this
 * config, the server and then the client; the client output is what
 * `vite preview` serves and what the static adapter copies into build/, so the
 * page is in the same place for the tests and for the deploy.
 *
 * @returns {import('vite').Plugin}
 */
export function englishLinkPreview() {
	return {
		name: 'escrow01-english-link-preview',
		apply: 'build',
		generateBundle(options) {
			const dir = (options.dir ?? '').replace(/\\/g, '/');
			if (!dir.endsWith('/output/client')) return;
			this.emitFile({ type: 'asset', fileName: 'en/index.html', source: englishPreviewPage() });
		}
	};
}
