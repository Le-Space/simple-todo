declare global {
	const __APP_VERSION__: string;
	const __BUILD_DATE__: string;
	const __BUILD_COMMIT__: string;
	// The chapter's folder name, e.g. escrow01 (node/chapter-commit.js).
	const __BUILD_CHAPTER__: string;
	const __APP_BRANCH__: string;
	// null when Vite could not resolve the package at build time.
	const __ORBITDB_VERSION__: string | null;
	const __HELIA_VERSION__: string | null;
	const __LIBP2P_VERSION__: string | null;
	namespace App {}
}
export {};
