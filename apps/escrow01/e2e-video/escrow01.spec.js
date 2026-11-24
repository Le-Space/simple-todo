// The demo film of escrow01: Alice hands a task to Bob with a budget locked in
// escrow, Bob does it, Alice pays out, the auditor looks on. Two browsers on
// one stage (Alice left, Bob right), one narrator, chapter titles top left.
//
// Each browser creates a fresh passkey of its own (a virtual authenticator, so
// no prompt waits for a finger): a passkey made on the page gets its Sepolia
// account at once, a recovered one would first ask whether to search again.
// The passkey step dialog is left on, so the film shows what prompts 2 and 3
// are for.
//
// Against the live chapter (the default) every step is real: the amount is
// encrypted in Alice's browser, the lock and the release are user operations
// on Sepolia. The cuts take the waits out of the film (account setup ~20 s,
// lock ~1 min, release ~25 s). DEMO_URL=local is a dry run against this
// checkout's E2E build, whose budget service is a fake: the steps, not the
// chain.
//
//   e2e-video/link-kit.sh                                # once
//   DEMO_VOICE=say DEMO_URL=local pnpm video:film        # dry run, macOS voice
//   DEMO_RES=2160 pnpm video:film                        # the real thing, English
//   DEMO_RES=2160 DEMO_LANG=de pnpm video:film           # … German
//
// Record only while nothing else runs on this machine.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { startStage } from '@le-space/video-kit/stage';
import { waitForConsent } from '../../../packages/e2e-kit/src/consent.mjs';
import { APP_URL, BRAND, LANG, NIGHT, voice } from './escrow01.js';

/** The app's own texts, so the film types into fields by what they say. */
const UI = JSON.parse(
	readFileSync(new URL(`../src/lib/i18n/${LANG}.json`, import.meta.url), 'utf8')
);
/** Shot against the live chapter, whose budget service is Sepolia's. */
const SEPOLIA = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(APP_URL);
const CHAIN = 180_000;

const EN = {
	intro:
		'Alice wants to hand a task to Bob and pay him once it is done. How much she pays should stay between them.',
	dialog: 'The start dialog says what this is: confidential payments by passkey. One button.',
	passkey: 'Alice creates a passkey. No password, no seed phrase.',
	steps:
		'A first passkey takes three confirmations. Before the second and the third, the app says what each one is for.',
	bob: 'Bob does the same in his own browser.',
	account:
		'Behind each passkey is an account on Sepolia: Uniswap’s Calibur smart account, through EIP-7702. Openfort pays the gas.',
	home: 'Alice starts in a private list of her own. Only she can write to it.',
	newList: 'Alice creates a private list. Only she can write to it.',
	todo: 'She adds a task and delegates it to Bob.',
	budget:
		'And a budget: 500 cUSDT, Zama’s confidential token. The amount is encrypted in her browser before it leaves.',
	lock: 'One passkey confirmation locks it in escrow.',
	chain:
		'Zama’s encryption hides the amount, not the parties. The chain shows who locked something for whom, and when. Never how much.',
	plain:
		'The task itself is not encrypted: anyone with the list’s address can read it. Only the amount is.',
	share: 'Alice shares the list’s address with Bob.',
	join: 'Bob opens it. The light under the list name turns green: their two browsers are now connected directly, peer to peer.',
	read: 'The task is delegated to Bob, and he reads the budget on his own device.',
	done: 'He ticks it off and signs the change with his passkey.',
	seen: 'Alice sees it at once. The budget waits for her release.',
	release: 'Alice releases the budget. Only she can, and only once.',
	balance:
		'Bob’s confidential balance now holds the 500. It is decrypted on his device; on the chain it stays encrypted.',
	auditor:
		'The escrow contract names one auditor. The auditor can read every amount, but cannot move any money.',
	auditorView:
		'This view lists the escrows on the chain. Their amounts open only with the auditor’s own key, so here they stay hidden.',
	end: 'One passkey for identity, data and payment. The amount stays confidential.'
};

/** @type {typeof EN} */
const DE = {
	intro:
		'Alice will Bob eine Aufgabe geben und ihn bezahlen, sobald sie erledigt ist. Wie viel sie zahlt, soll unter ihnen bleiben.',
	dialog:
		'Der Startdialog sagt, worum es geht: vertrauliche Zahlungen per Passkey. Ein einziger Knopf.',
	passkey: 'Alice legt einen Passkey an. Kein Passwort, keine Seed-Phrase.',
	steps:
		'Ein neuer Passkey braucht drei Bestätigungen. Vor der zweiten und dritten sagt die App, wofür sie ist.',
	bob: 'Bob macht dasselbe in seinem eigenen Browser.',
	account:
		'Hinter jedem Passkey steht ein Konto auf Sepolia: Calibur von Uniswap, über EIP-7702. Die Gebühren zahlt Openfort.',
	home: 'Alice startet in ihrer eigenen privaten Liste. Schreiben darf darin nur sie.',
	newList: 'Alice legt eine private Liste an. Schreiben darf darin nur sie.',
	todo: 'Sie legt eine Aufgabe an und delegiert sie an Bob.',
	budget:
		'Dazu ein Budget: 500 cUSDT, Zamas vertraulicher Token. Der Betrag wird in ihrem Browser verschlüsselt, bevor er ihn verlässt.',
	lock: 'Eine Bestätigung mit dem Passkey sperrt ihn treuhänderisch.',
	chain:
		'Zamas Verschlüsselung verbirgt den Betrag, nicht die Beteiligten. Die Chain zeigt, wer für wen etwas gesperrt hat, und wann. Aber nie, wie viel.',
	plain:
		'Die Aufgabe selbst ist nicht verschlüsselt: Wer die Adresse der Liste kennt, kann sie lesen. Verschlüsselt ist nur der Betrag.',
	share: 'Alice gibt Bob die Adresse der Liste.',
	join: 'Bob öffnet sie. Das Licht unter dem Listennamen wird grün: Die beiden Browser sind jetzt direkt verbunden, Peer-to-Peer.',
	read: 'Die Aufgabe ist an Bob delegiert, und er liest das Budget auf seinem eigenen Gerät.',
	done: 'Er hakt sie ab und unterschreibt die Änderung mit seinem Passkey.',
	seen: 'Alice sieht es sofort. Das Budget wartet auf ihre Freigabe.',
	release: 'Alice gibt das Budget frei. Nur sie kann das, und nur einmal.',
	balance:
		'Bobs vertrauliches Guthaben zeigt jetzt die 500. Entschlüsselt wird es auf seinem Gerät; auf der Chain bleibt es verschlüsselt.',
	auditor:
		'Der Treuhandvertrag nennt eine Prüfstelle. Sie kann jeden Betrag lesen, aber kein Geld bewegen.',
	auditorView:
		'Diese Ansicht listet die Sperren auf der Chain. Die Beträge öffnen sich nur mit dem Schlüssel der Prüfstelle, hier bleiben sie verborgen.',
	end: 'Ein Passkey für Identität, Daten und Zahlung. Der Betrag bleibt vertraulich.'
};

const LINES = LANG === 'de' ? DE : EN;

const W =
	LANG === 'de'
		? {
				alice: 'Alice',
				bob: 'Bob',
				chapters: [
					'Ein Passkey',
					'Eine Aufgabe mit Budget',
					'Bob kommt dazu, Peer-to-Peer',
					'Alice zahlt aus',
					'Die Prüfstelle'
				],
				list: 'Website-Relaunch',
				todo: 'Landingpage übersetzen'
			}
		: {
				alice: 'Alice',
				bob: 'Bob',
				chapters: [
					'One passkey',
					'A task with a budget',
					'Bob joins, peer to peer',
					'Alice pays out',
					'The auditor'
				],
				list: 'Website relaunch',
				todo: 'Translate the landing page'
			};

// Without a media permission Chromium offers only the default route's address
// to WebRTC, and two browsers behind a VPN never connect directly (as in
// Belege's films). The app never asks for a microphone.
const CONTEXT = {
	permissions: ['microphone'],
	locale: LANG === 'de' ? 'de-DE' : 'en-GB',
	baseURL: APP_URL
};

/**
 * A platform authenticator with PRF, as the suite's (e2e-kit/webauthn.mjs), but
 * with the passkey step dialog left on: the film wants to show it.
 * @param {import('@playwright/test').Page} page
 */
async function authenticator(page) {
	await page.addInitScript(() => {
		// E2E builds leave the step dialog off unless asked; the live build shows it anyway.
		/** @type {any} */ (globalThis).__simpleTodoPasskeySteps = true;
	});
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
}

/** @param {import('@playwright/test').Page} page @param {string} section listen | aufgaben | konto */
const tab = (page, section) => page.getByTestId(`tab-${section}`);
/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder(UI.todo.form.placeholder);
/** @param {import('@playwright/test').Page} page */
const row = (page) => page.getByTestId('todo-item').filter({ hasText: W.todo });

test('escrow01: a task, a budget, one passkey', async ({ browser }, testInfo) => {
	test.setTimeout(900_000);
	const stage = await startStage(browser, testInfo, LINES, {
		voice,
		lang: LANG,
		night: NIGHT,
		accent: BRAND.palette.accent,
		font: BRAND.font,
		devices: {
			alice: { label: W.alice, x: 40, y: 120, width: 900, height: 850, zoom: 1, context: CONTEXT },
			bob: { label: W.bob, x: 980, y: 120, width: 900, height: 850, zoom: 1, context: CONTEXT }
		}
	});
	const alice = stage.devices.alice.page;
	const bob = stage.devices.bob.page;
	const chapter = (/** @type {number} */ n) => stage.chapter(W.chapters[n - 1], { n });

	/**
	 * The two step dialogs that follow the start dialog's one button: each says
	 * which prompt comes and why, and its "Continue" lets the prompt happen.
	 * @param {import('@playwright/test').Page} page
	 */
	async function confirmSteps(page) {
		const steps = page.locator('passkey-step-dialog');
		for (const [n, of] of [
			[2, 3],
			[3, 3]
		]) {
			await page.waitForFunction(
				() => /** @type {any} */ (document.querySelector('passkey-step-dialog'))?.isOpen === true,
				undefined,
				{ timeout: 90_000 }
			);
			await expect(steps.locator('[part=count]')).toHaveText(new RegExp(`${n}\\D+${of}`), {
				timeout: 30_000
			});
			await stage.beat(900);
			await stage.click(page, steps.getByRole('button', { name: /^(Continue|Weiter)$/ }));
		}
		await expect(todoInput(page)).toBeEnabled({ timeout: 90_000 });
	}

	/** @param {import('@playwright/test').Page} page */
	async function accountReady(page) {
		await stage.click(page, tab(page, 'konto'));
		if (SEPOLIA)
			await stage.cutWhile(() =>
				expect(page.getByTestId('chain-account-address')).toBeVisible({ timeout: CHAIN })
			);
		else await expect(page.getByTestId('account-chain')).toBeVisible();
	}

	try {
		for (const page of [alice, bob]) await authenticator(page);
		await Promise.all([alice.goto('./'), bob.goto('./')]);
		await Promise.all([waitForConsent(alice), waitForConsent(bob)]);
		stage.markStart();

		// 1 · One passkey
		await stage.focus('alice', 'bob');
		await chapter(1);
		await stage.say(LINES.intro);
		await stage.focus('alice');
		await stage.say(LINES.dialog);
		await stage.sayWhile(LINES.passkey, () =>
			stage.click(alice, alice.getByTestId('consent-proceed'))
		);
		await stage.sayWhile(LINES.steps, () => confirmSteps(alice));
		await stage.focus('bob');
		await stage.sayWhile(LINES.bob, async () => {
			await stage.click(bob, bob.getByTestId('consent-proceed'));
			await confirmSteps(bob);
		});
		await stage.focus('alice', 'bob');
		await stage.sayWhile(LINES.account, () =>
			Promise.all([accountReady(alice), accountReady(bob)])
		);
		const bobDid = await bob.getByTestId('own-did-value').getAttribute('data-did');
		if (!bobDid) throw new Error('Bob’s DID badge has no data-did');

		// 2 · A task with a budget
		await stage.focus('alice');
		await chapter(2);
		await stage.click(alice, tab(alice, 'aufgaben'));
		await expect(todoInput(alice)).toBeEnabled({ timeout: 60_000 });
		// The private start (feat/escrow01-private-start) opens a private list of
		// one's own; until it is live, the shared list comes first and Alice
		// makes the private list herself.
		if ((await alice.getByTestId('add-todo-delegate-toggle').count()) > 0) {
			await stage.say(LINES.home);
		} else {
			await stage.sayWhile(LINES.newList, async () => {
				await stage.click(alice, tab(alice, 'listen'));
				await stage.type(alice, alice.getByTestId('new-list-name'), W.list);
				await stage.click(alice, alice.getByTestId('new-list-create'));
				await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout: 60_000 });
				await stage.click(alice, tab(alice, 'aufgaben'));
				await expect(todoInput(alice)).toBeEnabled({ timeout: 60_000 });
			});
		}
		await stage.sayWhile(LINES.todo, async () => {
			await stage.type(alice, todoInput(alice), W.todo);
			await stage.click(alice, alice.getByTestId('add-todo-delegate-toggle'));
			const did = alice.getByTestId('add-todo-delegate-did');
			await stage.click(alice, did);
			await did.fill(bobDid);
		});
		await stage.sayWhile(LINES.budget, () =>
			stage.type(alice, alice.getByTestId('add-todo-budget'), '500')
		);
		await stage.say(LINES.lock);
		await stage.click(alice, alice.getByTestId('add-todo-submit'));
		const aliceChip = row(alice).getByTestId('todo-budget');
		await stage.cutWhile(() =>
			expect(aliceChip).toHaveAttribute('data-status', 'funded', { timeout: CHAIN })
		);
		// Reading the amount back opens the read key once per visit (Sepolia).
		const aliceUnlock = alice.getByTestId('budget-unlock-read');
		if (await aliceUnlock.isVisible()) {
			await stage.click(alice, aliceUnlock);
			await stage.cutWhile(() => expect(aliceChip).toContainText(/500/, { timeout: CHAIN }));
		}
		await stage.say(LINES.chain);
		await stage.say(LINES.plain);

		// 3 · Bob joins, peer to peer
		await chapter(3);
		const address = (
			(await alice.getByTestId('active-database-address').textContent()) ?? ''
		).trim();
		if (!address.startsWith('/orbitdb/')) throw new Error(`no list address: ${address}`);
		await stage.focus('alice', 'bob');
		await stage.say(LINES.share);
		await stage.click(bob, tab(bob, 'listen'));
		const input = bob.getByTestId('open-db-address-input');
		await stage.click(bob, input);
		await input.fill(address);
		await stage.click(bob, bob.getByTestId('open-db-button'));
		await stage.click(bob, tab(bob, 'aufgaben'));
		await stage.cutWhile(() =>
			Promise.all([
				expect(row(bob)).toBeVisible({ timeout: 120_000 }),
				expect(alice.getByTestId('list-peer-led')).toHaveAttribute('data-state', 'direct', {
					timeout: 120_000
				}),
				expect(bob.getByTestId('list-peer-led')).toHaveAttribute('data-state', 'direct', {
					timeout: 120_000
				})
			])
		);
		await stage.say(LINES.join);
		await stage.focus('bob');
		const bobChip = row(bob).getByTestId('todo-budget');
		await stage.sayWhile(LINES.read, async () => {
			const unlock = bob.getByTestId('budget-unlock-read');
			if (await unlock.isVisible()) await stage.click(bob, unlock);
			// The fake keeps amounts in the tab that locked them: Bob's shows "•••".
			if (SEPOLIA) await expect(bobChip).toContainText(/500/, { timeout: CHAIN });
			else await expect(bobChip).toBeVisible();
		});
		await stage.sayWhile(LINES.done, async () => {
			await stage.click(bob, row(bob).getByTestId('todo-complete-checkbox'));
			await expect(bob.getByTestId('delegated-auth-state')).toBeVisible({ timeout: 60_000 });
		});
		await stage.focus('alice');
		await stage.cutWhile(() =>
			expect(row(alice).getByTestId('todo-release-budget')).toBeVisible({ timeout: 120_000 })
		);
		await stage.say(LINES.seen);

		// 4 · Alice pays out
		await chapter(4);
		await stage.say(LINES.release);
		await stage.click(alice, row(alice).getByTestId('todo-release-budget'));
		await stage.cutWhile(() =>
			expect(aliceChip).toHaveAttribute('data-status', 'released', { timeout: CHAIN })
		);
		await stage.focus('bob');
		await stage.click(bob, tab(bob, 'konto'));
		await stage.cutWhile(() =>
			SEPOLIA
				? expect(bob.getByTestId('budget-balance-value')).toContainText(/500/, { timeout: CHAIN })
				: expect(bob.getByTestId('budget-balance')).toBeVisible({ timeout: 60_000 })
		);
		await stage.say(LINES.balance);

		// 5 · The auditor
		await stage.focus('alice');
		await chapter(5);
		await stage.click(alice, tab(alice, 'konto'));
		await stage.say(LINES.auditor);
		await stage.click(alice, alice.getByTestId('auditor-view-open'));
		await stage.cutWhile(() =>
			expect(alice.getByTestId('auditor-row').first()).toBeVisible({ timeout: CHAIN })
		);
		await stage.say(LINES.auditorView);

		await stage.focus('alice', 'bob');
		await stage.chapter(null);
		await stage.say(LINES.end, { after: 1500 });
	} finally {
		await stage.finish({ name: `escrow01.${LANG}` });
	}
});
