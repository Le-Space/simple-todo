import { afterEach, describe, expect, it } from 'vitest';
import { forget, forgetSession, recall, remember } from './browser-memory.js';
import { setPersistentStorageEnabled } from './storage-mode.js';

afterEach(() => {
	forgetSession();
	localStorage.clear();
});

describe('what a browser remembers', () => {
	it('writes nothing to the device in memory mode', () => {
		setPersistentStorageEnabled(false);
		remember('simpleTodo.sharedListMnemonic.v1', 'perro gato casa');

		expect(localStorage.length).toBe(0);
		expect(recall('simpleTodo.sharedListMnemonic.v1')).toBe('perro gato casa');
	});

	it('writes to the device once the reader asked for that', () => {
		setPersistentStorageEnabled(true);
		remember('simpleTodo.sharedListMnemonic.v1', 'perro gato casa');

		expect(localStorage.getItem('simpleTodo.sharedListMnemonic.v1')).toBe('perro gato casa');
	});

	it('does not read a leftover from an earlier persistent session', () => {
		// Somebody ran with IndexedDB, then chose memory. The old value is still
		// on the device until the wipe runs; it must not be handed out as if it
		// belonged to this session.
		localStorage.setItem('simpleTodo.identityMode', 'passkey');
		setPersistentStorageEnabled(false);

		expect(recall('simpleTodo.identityMode')).toBeNull();
	});

	it('forgets in both places', () => {
		setPersistentStorageEnabled(true);
		remember('simpleTodo.identityMode', 'anonymous');
		forget('simpleTodo.identityMode');

		expect(localStorage.getItem('simpleTodo.identityMode')).toBeNull();
		expect(recall('simpleTodo.identityMode')).toBeNull();
	});

	it('keeps what it was given when the device refuses to store it', () => {
		setPersistentStorageEnabled(true);
		const setItem = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new DOMException('quota', 'QuotaExceededError');
		};
		try {
			remember('simpleTodo.locale', 'de');
			expect(recall('simpleTodo.locale')).toBe('de');
		} finally {
			Storage.prototype.setItem = setItem;
		}
	});
});
