import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { chapterCommit } from '@simple-todo/todo/node/chapter-commit.js';

// update version in package.json and title
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

/**
 * The version a dependency actually resolved to, read from what is installed
 * rather than from the range in package.json — "^4.0.0" is a request, and the
 * header should report what shipped.
 *
 * The header used to render the app's own version directly after the words
 * "IPFS + OrbitDB", so 0.3.1 read as an OrbitDB version. Baking a number per
 * dependency here, beside `__APP_VERSION__`, lets every name in that line carry
 * its own without the bundle importing a package.json at runtime.
 *
 * @param {string} name
 * @returns {string | null} null when the package cannot be read, so the header
 *   omits the name entirely instead of showing a guess.
 */
function installedVersion(name) {
	try {
		const manifest = fileURLToPath(new URL(`node_modules/${name}/package.json`, import.meta.url));
		const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
		return typeof version === 'string' && version.length > 0 ? version : null;
	} catch {
		return null;
	}
}

// The chapter's last commit and that commit's instant — not the build clock.
// Rebuilding a commit has to give the same bytes, and on IPFS the same CID; the
// browser formats the instant in the reader's locale, clock and zone.
const built = chapterCommit(fileURLToPath(new URL('.', import.meta.url)));
const appBranch = process.env.VITE_APP_BRANCH || process.env.GITHUB_REF_NAME || 'local';

export default defineConfig({
	// Workspace packages ship source, not a build; SvelteKit has to process
	// them itself when it prerenders.
	ssr: { noExternal: [/^@simple-todo\//] },
	test: {
		include: ['src/**/*.spec.js'],
		browser: {
			enabled: true,
			headless: true,
			provider: 'playwright',
			instances: [{ browser: 'chromium' }]
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		nodePolyfills(
			/** @type {any} */ ({
				include: [
					'path',
					'util',
					'buffer',
					'process',
					'events',
					'crypto',
					'os',
					'stream',
					'string_decoder',
					'readable-stream',
					'safe-buffer'
				],
				globals: {
					Buffer: true,
					global: true,
					process: true
				},
				protocolImports: true
			})
		)
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_DATE__: JSON.stringify(built.date),
		__BUILD_COMMIT__: JSON.stringify(built.commit),
		__APP_BRANCH__: JSON.stringify(appBranch),
		__ORBITDB_VERSION__: JSON.stringify(installedVersion('@orbitdb/core')),
		__HELIA_VERSION__: JSON.stringify(installedVersion('helia')),
		__LIBP2P_VERSION__: JSON.stringify(installedVersion('libp2p'))
	}
});
