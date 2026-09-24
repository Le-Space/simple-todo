/**
 * Writing invoices into the list.
 *
 * Everything here goes through the same database as the todos, so an invoice
 * inherits the list's access control: the owner writes, a shared list carries
 * it, and a list that is sealed seals it too. Reading happens in
 * `db-actions.js`, which folds the log into `invoicesStore`.
 */

import { get } from 'svelte/store';
import { ownIdentityIdStore, todoDBStore } from './db-actions.js';
import {
	INVOICE_SETTINGS_KEY,
	circleOf,
	nextNumberFor,
	normaliseInvoiceSettings
} from './invoice/settings.js';
import {
	cancellationFor,
	draftProblems,
	emptyDraft,
	invoiceKey,
	issue
} from './invoice/records.js';
import {
	customerFromInvoice,
	customerKey,
	customerProblems,
	markDeleted
} from './invoice/customers.js';
import { customersStore, invoiceSettingsStore, invoicesStore } from './invoice/store.js';

/**
 * Every action answers in the same shape, so a caller can read `ok` and then
 * `error` without asking which function it called.
 *
 * @typedef {{ ok: boolean, error?: string, problems?: any[], number?: string, draft?: any, customer?: any, storno?: any }} Result
 */

/** @returns {{ db: any, identityId: string } | null} */
function ready() {
	const db = get(todoDBStore);
	const identityId = get(ownIdentityIdStore);
	return db && identityId ? { db, identityId } : null;
}

/** The settings of the open list, with this identity's own circle filled in. */
export function currentInvoiceSettings() {
	const identityId = get(ownIdentityIdStore) ?? '';
	return normaliseInvoiceSettings(get(invoiceSettingsStore), identityId);
}

/** The circle this device issues from. */
export function currentCircle() {
	return circleOf(currentInvoiceSettings(), get(ownIdentityIdStore) ?? '');
}

/** The number the next invoice of this device would carry. */
export function previewNextNumber(date = new Date()) {
	const identityId = get(ownIdentityIdStore);
	if (!identityId) return null;
	const issued = get(invoicesStore)
		.filter((invoice) => invoice.state === 'issued' && invoice.number)
		.map((invoice) => invoice.number);
	return nextNumberFor(currentInvoiceSettings(), identityId, issued, date);
}

/**
 * @param {Partial<ReturnType<typeof currentInvoiceSettings>>} patch
 * @returns {Promise<Result>}
 */
export async function saveInvoiceSettings(patch) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };

	try {
		const next = { ...currentInvoiceSettings(), ...patch };
		await context.db.put(INVOICE_SETTINGS_KEY, next);
		invoiceSettingsStore.set(next);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/**
 * Write a draft. Drafts are ordinary entries and may be written as often as
 * anyone likes; an issued invoice never comes back through here.
 *
 * @param {any} draft
 * @returns {Promise<Result>}
 */
export async function saveInvoiceDraft(draft) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };
	if (draft?.state === 'issued') {
		return { ok: false, error: 'An issued invoice is corrected, not changed.' };
	}

	try {
		await context.db.put(invoiceKey(draft.id), {
			...draft,
			state: 'draft',
			updatedAt: new Date().toISOString()
		});
		return { ok: true };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/**
 * Issue a draft: assign the number, freeze the document, write it once.
 *
 * The draft is passed in rather than looked up. Writing it and reading it back
 * are two different moments: `saveInvoiceDraft` returns when OrbitDB has the
 * entry, while `invoicesStore` is only refilled when the log has been re-read,
 * which is later. A lookup here therefore missed a draft that had just been
 * saved, and issuing failed on the first press and worked on the second.
 *
 * @param {any} draft
 * @param {{ date?: Date, template?: string }} [options] `template` is the
 *   wording this invoice goes out with, which the app takes from the settings
 *   or, where nobody edited them, from the reader's language.
 * @returns {Promise<Result>}
 */
export async function issueInvoiceDraft(draft, { date = new Date(), template = '' } = {}) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };

	if (!draft?.id) return { ok: false, error: 'There is no invoice to issue.' };
	if (draft.state === 'issued') return { ok: false, error: 'This invoice was already issued.' };

	const settings = currentInvoiceSettings();
	const problems = draftProblems(draft, { issuer: settings.issuer });
	if (problems.length > 0) return { ok: false, error: problems[0].code, problems };

	try {
		const number = previewNextNumber(date);
		if (!number) return { ok: false, error: 'No series to issue from.' };
		const invoice = issue(draft, {
			number,
			issuer: settings.issuer,
			issuedBy: context.identityId,
			issuedAt: date.toISOString(),
			// What the letter said when it went out, not what it says now.
			template: template || settings.template
		});
		await context.db.put(invoiceKey(invoice.id), invoice);
		return { ok: true, number };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/**
 * Start the correction of an issued invoice: a Storno draft that takes the
 * amounts back. It is issued like any other invoice and gets the next number;
 * the invoice it cancels stays exactly as it was.
 *
 * @param {string} number
 * @returns {Promise<Result>}
 */
export async function startCancellation(number) {
	const issued = get(invoicesStore).find(
		(invoice) => invoice.state === 'issued' && invoice.number === number
	);
	if (!issued) return { ok: false, error: 'This invoice is not in the list.' };
	if (issued.cancelledBy) return { ok: false, error: 'This invoice was already cancelled.' };

	const storno = cancellationFor(issued);
	const written = await saveInvoiceDraft(storno);
	return written.ok ? { ok: true, draft: storno } : written;
}

/**
 * Delete a draft. Only a draft: an issued invoice is a Buchungsbeleg, and
 * §147 AO keeps it for eight years.
 *
 * @param {string} id
 * @returns {Promise<Result>}
 */
export async function deleteInvoiceDraft(id) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };

	const invoice = get(invoicesStore).find((entry) => entry.id === id);
	if (invoice?.state === 'issued') {
		return { ok: false, error: 'An issued invoice is cancelled, not deleted.' };
	}

	try {
		await context.db.del(invoiceKey(id));
		return { ok: true };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/** @param {unknown} error */
function describe(error) {
	const message = error instanceof Error ? error.message : String(error);
	return /not append|denied|permission/i.test(message)
		? 'Your identity has no write permission for this list.'
		: message;
}

/**
 * Keep a customer in the directory, or update the one that is there.
 *
 * @param {{ name?: string, address?: string, vatId?: string }} block what the
 *   invoice's customer fields say
 * @param {{ id?: string }} [options] the entry to update, if this is one
 * @returns {Promise<Result>}
 */
export async function saveCustomer(block, { id } = {}) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };

	const problems = customerProblems(block);
	if (problems.length > 0) return { ok: false, error: problems[0].code, problems };

	const existing = id ? get(customersStore).find((customer) => customer.id === id) : null;
	const entry = customerFromInvoice(block, existing ?? {});
	try {
		await context.db.put(customerKey(entry.id), entry);
		return { ok: true, customer: entry };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/**
 * Mark a customer deleted.
 *
 * Deliberately not a `del`: the entry is hidden here, and the log keeps what it
 * already replicated. Saying otherwise would be the one dishonest thing this
 * chapter could do about personal data — see `docs/invoicing.md`.
 *
 * @param {string} id
 * @returns {Promise<Result>}
 */
export async function deleteCustomer(id) {
	const context = ready();
	if (!context) return { ok: false, error: 'The list is not open yet.' };

	const entry = get(customersStore).find((customer) => customer.id === id);
	if (!entry) return { ok: false, error: 'This customer is not in the list.' };

	try {
		await context.db.put(customerKey(id), markDeleted(entry));
		return { ok: true };
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

/**
 * Take back an invoice whose number went out twice, and prepare its replacement.
 *
 * Two drafts, not two invoices: issuing stays the deliberate act it is
 * everywhere else in this chapter. What this does is remove the guesswork —
 * the Storno for the number that clashed, and a copy of the invoice ready to go
 * out under the next free one.
 *
 * @param {any} invoice the issued invoice that has to give way
 * @returns {Promise<Result>}
 */
export async function reissueDuplicate(invoice) {
	const started = await startCancellation(invoice.number);
	if (!started.ok) return started;

	const copy = {
		...emptyDraft({ taxMode: invoice.taxMode, customer: invoice.customer }),
		issueDate: invoice.issueDate,
		deliveryDate: invoice.deliveryDate,
		paymentTermsDays: invoice.paymentTermsDays,
		notes: invoice.notes ?? '',
		lines: (invoice.lines ?? []).map((/** @type {any} */ line) => ({
			...line,
			details: [...(line.details ?? [])]
		}))
	};
	const written = await saveInvoiceDraft(copy);
	return written.ok ? { ok: true, draft: copy, storno: started.draft } : written;
}
