// Between two passkey prompts, a word on what the next one is for.
//
// Creating a passkey asks the authenticator up to four times in a row;
// restoring one in a fresh browser three times. Without a word in between
// that looks like a loop, or like something broken (a YubiKey asked four
// times, 2026-10-16). So before each further prompt the page says what it is
// for and waits for "Continue": the prompt then starts from that click, which
// browsers that want a user gesture for every WebAuthn call need anyway.
// "Cancel" stops the start before the prompt; nothing has been opened yet.
//
// Ported from Le-Space/belege (`passkey-steps.svelte.js`, belege#430), as a
// store so the chapter's legacy-mode components can read it. The provider
// itself has no hook before its own prompts yet
// (Le-Space/orbitdb-identity-provider-webauthn-did#89); until it has, the
// page announces the provider's prompts from what it knows will come.

import { writable } from 'svelte/store';

/** @typedef {'restore' | 'prf' | 'proof'} PasskeyPurpose */
/** @typedef {{ n: number, of: number, purpose: PasskeyPurpose }} PasskeyStep */

/**
 * The step on screen, or null. `resolve` continues, `reject` cancels.
 * @type {import('svelte/store').Writable<{ step: PasskeyStep | null, resolve: (() => void) | null, reject: ((error: Error) => void) | null }>}
 */
export const passkeyStep = writable({ step: null, resolve: null, reject: null });

/** Thrown when someone cancels between two prompts. */
export class PasskeyStepCancelled extends Error {
	constructor() {
		super('cancelled between two passkey prompts');
		this.name = 'PasskeyStepCancelled';
	}
}

/**
 * Show the step and wait for "Continue".
 *
 * A test with a virtual authenticator needs no explanation and sets
 * `__simpleTodoSkipPasskeySteps` before the page loads; the dialog then
 * resolves at once.
 *
 * @param {PasskeyStep} step
 * @returns {Promise<void>} rejects with PasskeyStepCancelled on "Cancel"
 */
export function confirmPasskeyStep(step) {
	if (/** @type {any} */ (globalThis).__simpleTodoSkipPasskeySteps) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const done = () => passkeyStep.set({ step: null, resolve: null, reject: null });
		passkeyStep.set({
			step,
			resolve: () => {
				done();
				resolve();
			},
			reject: (error) => {
				done();
				reject(error);
			}
		});
	});
}

/**
 * The prompts a start will make, after the first — which the proceed button
 * starts itself — and what each one is for.
 *
 * - create: the passkey (1), the PRF read (2), the identity proof (3).
 * - stored: a credential this browser kept; no touch to find it, the signing
 *   key and the identity proof are kept too. With the archive on, one touch
 *   for the PRF output, from the button — no dialog.
 * - restore: nothing stored (memory mode, or a fresh browser). Two touches
 *   find the passkey (1, 2), then the PRF read for the archive (3) when it is
 *   on, then the identity proof — the restore brought the signing key, so the
 *   provider asks for nothing else.
 *
 * @param {{ mode: 'create' | 'stored' | 'restore', prf: boolean }} start
 * @returns {Partial<Record<PasskeyPurpose, PasskeyStep>>} the steps to announce, by purpose
 */
export function passkeyStepsFor({ mode, prf }) {
	/** @type {Partial<Record<PasskeyPurpose, PasskeyStep>>} */
	const steps = {};
	if (mode === 'create') {
		const of = prf ? 3 : 2;
		if (prf) steps.prf = { n: 2, of, purpose: 'prf' };
		steps.proof = { n: of, of, purpose: 'proof' };
	} else if (mode === 'restore') {
		const of = 3 + (prf ? 1 : 0);
		steps.restore = { n: 1, of, purpose: 'restore' };
		if (prf) steps.prf = { n: 3, of, purpose: 'prf' };
		steps.proof = { n: of, of, purpose: 'proof' };
	}
	return steps;
}

/**
 * Announce a step, when the start has one of that purpose.
 *
 * @param {Partial<Record<PasskeyPurpose, PasskeyStep>>} steps
 * @param {PasskeyPurpose} purpose
 */
export async function announce(steps, purpose) {
	const step = steps[purpose];
	if (step) await confirmPasskeyStep(step);
}
