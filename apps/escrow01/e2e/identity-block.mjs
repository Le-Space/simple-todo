/**
 * The block of a session's OrbitDB identity, as a `LoadBlockFailedError` in
 * the log names it (CIDv1, base32), so a failed load can be told apart: the
 * signer's identity document, or an entry (#127).
 */
import { CID } from 'multiformats/cid';

/** @param {import('@playwright/test').Page} page */
export async function identityBlock(page) {
	await page.waitForFunction(
		() => /** @type {any} */ (window).__simpleTodoE2E?.getOrbitDBIdentity?.()?.hash,
		null,
		{ timeout: 60_000 }
	);
	const hash = await page.evaluate(
		() => /** @type {any} */ (window).__simpleTodoE2E.getOrbitDBIdentity().hash
	);
	try {
		return CID.parse(String(hash)).toString();
	} catch {
		return String(hash);
	}
}
