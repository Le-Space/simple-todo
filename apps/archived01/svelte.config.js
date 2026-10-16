import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// favicons, manifest and robots.txt are the same bytes in every chapter
		files: { assets: '../../packages/brand/static' }
	}
};

export default config;
