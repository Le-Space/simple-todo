import adapter from '@sveltejs/adapter-static';

// Where a page may load from and talk to. A chapter whose archive key signs
// for an account (archived01) has one more reason than the others to keep
// foreign script out: a script in this tab can ask the authenticator and walk
// off with the PRF output at the next touch (audit 2026-10-16, HIGH-2). The
// policy is the cheapest door to close.
//
// Prerendered and served from IPFS, so the policy is a <meta> tag SvelteKit
// writes into the page, with a hash for the one inline script it emits itself
// (`mode: 'hash'`); the theme script in app.html is external for that reason.
// `frame-ancestors` cannot be set in a <meta> tag and is left out.
//
// Connections: any TLS host. A relay is whatever peer somebody names in the
// connect form, and the relay button provisions a VM on whichever Aleph
// compute node the list offers, then talks to that node by its own name — no
// finite list of hosts describes that. Scripts stay strict, which is what
// keeps a foreign script out in the first place; `vite dev` and the E2E build
// (VITE_NODE_ENV=development, local relay over plain ws) may also use http and ws.
const local = process.env.VITE_NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// favicons, manifest and robots.txt are the same bytes in every chapter
		files: { assets: '../../packages/brand/static' },
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// Svelte and the transitions set style attributes; a hash cannot
				// cover those. Styles are the smaller risk, scripts stay strict.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self', 'https:', 'wss:', ...(local ? ['http:', 'ws:'] : [])],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'media-src': ['none'],
				'object-src': ['none'],
				'frame-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
