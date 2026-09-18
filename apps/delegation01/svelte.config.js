import adapter from '@sveltejs/adapter-static';

/**
 * The chapter has no `static/` of its own: favicons, manifest and robots.txt
 * are the same bytes in every chapter and live in `@simple-todo/brand`.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
	kit: {
		adapter: adapter(),
		files: { assets: '../../packages/brand/static' }
	}
};

export default config;
