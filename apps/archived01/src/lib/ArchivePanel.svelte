<script>
	import { _ } from '$lib/i18n/index.js';
	import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
	import {
		archiveStore,
		BACKEND_KINDS,
		ALEPH_CHANNEL,
		unlockArchive,
		enableArchive,
		disableArchive,
		chooseBackend,
		flushArchive,
		listArchive,
		restoreArchive,
		setBackendSecret,
		hasBackendSecret,
		refreshCredits,
		recoverFromArchive
	} from '$lib/archive/archive.js';

	/** The passkey behind the identity; without one there is no archive. */
	export let credential = /** @type {any} */ (null);
	/** The todo list is open and writable. */
	export let ready = false;

	let secret = '';
	let secretStored = false;
	const persistent = getPersistentStorageEnabled();
	/** @type {string | null} */
	let localError = null;

	$: kind = $archiveStore.backend;
	$: needsSecret = kind === 'pinata' || kind === 'lighthouse';
	$: secretStored = needsSecret ? hasBackendSecret(kind) : true;
	$: busy = $archiveStore.busy !== '';
	$: canAct = ready && $archiveStore.unlocked && !busy;

	/** @param {unknown} error */
	const reason = (error) => (error instanceof Error ? error.message : String(error));

	/** @param {() => Promise<unknown>} action */
	async function run(action) {
		localError = null;
		try {
			await action();
		} catch (error) {
			localError = reason(error);
		}
	}

	const onUnlock = () => run(() => unlockArchive({ credential }));
	const onEnable = () => run(() => enableArchive({ backend: kind }));
	const onDisable = () => run(() => disableArchive());
	const onFlush = () => run(() => flushArchive());
	const onList = () => run(() => listArchive());
	const onRestore = () => run(() => restoreArchive());
	const onRecover = () => run(() => recoverFromArchive({ credential }));
	const onSecret = () =>
		run(async () => {
			await setBackendSecret(kind, secret);
			secret = '';
			secretStored = hasBackendSecret(kind);
			if ($archiveStore.enabled) await chooseBackend(kind);
		});

	/** @param {Event} event */
	const onKind = (event) =>
		run(() =>
			chooseBackend(/** @type {any} */ (/** @type {HTMLSelectElement} */ (event.target).value))
		);

	/** @param {number | undefined} bytes */
	const kb = (bytes) => (typeof bytes === 'number' ? `${(bytes / 1024).toFixed(1)} kB` : '');
	/** @param {number | Date | undefined} at */
	const when = (at) => (at ? new Date(at).toLocaleTimeString() : '');

	let copied = false;
	async function copyAddress() {
		if (!$archiveStore.address) return;
		await navigator.clipboard.writeText($archiveStore.address);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<section class="mb-6 rounded-lg bg-surface p-6 shadow-md" data-testid="archive-panel">
	<div class="mb-2 flex items-center justify-between gap-3">
		<h2 class="text-xl font-semibold">{$_('archive.title')}</h2>
		<span
			class="rounded-full px-2 py-0.5 text-xs"
			class:bg-cyan-100={$archiveStore.running}
			class:text-cyan-900={$archiveStore.running}
			class:bg-surface-2={!$archiveStore.running}
			class:text-faint={!$archiveStore.running}
			data-testid="archive-state"
			data-state={!credential
				? 'no-passkey'
				: !$archiveStore.unlocked
					? 'locked'
					: $archiveStore.running
						? 'running'
						: 'off'}
		>
			{#if !credential}{$_('archive.state.noPasskey')}{:else if !$archiveStore.unlocked}{$_(
					'archive.state.locked'
				)}{:else if $archiveStore.running}{$_('archive.state.running')}{:else}{$_(
					'archive.state.off'
				)}{/if}
		</span>
	</div>

	<p class="mb-4 text-sm text-faint">{$_('archive.intro')}</p>

	{#if !credential}
		<p class="text-sm" data-testid="archive-needs-passkey">{$_('archive.needsPasskey')}</p>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-3">
			<label class="text-sm">
				<span class="mr-2">{$_('archive.store')}</span>
				<select
					class="rounded-md border border-border bg-surface px-2 py-1 text-sm"
					value={kind}
					on:change={onKind}
					disabled={busy}
					data-testid="archive-backend"
				>
					{#each BACKEND_KINDS as option (option)}
						<option value={option}>{$_(`archive.stores.${option}`)}</option>
					{/each}
				</select>
			</label>
			{#if !$archiveStore.unlocked}
				<button
					type="button"
					class="rounded-md bg-coral-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-faint"
					on:click={onUnlock}
					disabled={busy || !ready}
					data-testid="archive-unlock"
				>
					{$archiveStore.busy === 'unlocking' ? $_('archive.unlocking') : $_('archive.unlock')}
				</button>
				<button
					type="button"
					class="rounded-md border border-border px-4 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
					on:click={onRecover}
					disabled={busy || !ready || !secretStored}
					data-testid="archive-recover"
				>
					{$_('archive.recover')}
				</button>
			{:else if !$archiveStore.enabled}
				<button
					type="button"
					class="rounded-md bg-coral-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-faint"
					on:click={onEnable}
					disabled={!canAct || !secretStored}
					data-testid="archive-enable"
				>
					{$_('archive.enable')}
				</button>
			{:else}
				<button
					type="button"
					class="rounded-md border border-border px-4 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:cursor-not-allowed"
					on:click={onDisable}
					disabled={busy}
					data-testid="archive-disable"
				>
					{$_('archive.disable')}
				</button>
			{/if}
		</div>

		<p class="mb-3 text-xs text-faint">{$_(`archive.storeHelp.${kind}`)}</p>
		{#if !$archiveStore.unlocked}
			<p class="mb-3 text-xs text-faint" data-testid="archive-locked-hint">
				{$_('archive.lockedHint')}
			</p>
		{/if}

		{#if needsSecret && $archiveStore.unlocked}
			<form class="mb-4 flex flex-wrap items-center gap-2" on:submit|preventDefault={onSecret}>
				<input
					type="password"
					class="min-w-0 flex-1 rounded-md border border-border px-3 py-1.5 text-sm"
					placeholder={$_(`archive.secretPlaceholder.${kind}`)}
					bind:value={secret}
					autocomplete="off"
					data-testid="archive-secret"
				/>
				<button
					type="submit"
					class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
					disabled={busy}
					data-testid="archive-secret-save"
				>
					{secretStored ? $_('archive.secretReplace') : $_('archive.secretSave')}
				</button>
				<span class="w-full text-xs text-faint">{$_('archive.secretHelp')}</span>
			</form>
		{/if}

		{#if $archiveStore.unlocked && $archiveStore.address}
			<div
				class="mb-4 rounded-md bg-cyan-50 p-3 text-sm dark:bg-cyan/10"
				data-testid="archive-account"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-faint">{$_('archive.account')}</span>
					<code class="font-mono text-xs break-all" data-testid="archive-address"
						>{$archiveStore.address}</code
					>
					<button
						type="button"
						class="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
						on:click={copyAddress}>{copied ? $_('archive.copied') : $_('archive.copy')}</button
					>
				</div>
				{#if kind === 'aleph'}
					<p class="mt-2 text-sm" data-testid="archive-credits">
						{#if $archiveStore.credits}
							{$_('archive.credits', {
								values: { credits: $archiveStore.credits.credits.toLocaleString() }
							})}
							{#if $archiveStore.credits.days != null}
								· {$_('archive.creditsLast', {
									values: { days: Math.floor($archiveStore.credits.days).toLocaleString() }
								})}
								{#if $archiveStore.credits.hourly != null}
									({$_('archive.creditsMeasured', {
										values: {
											hourly: $archiveStore.credits.hourly.toLocaleString(),
											mib: ($archiveStore.credits.mib ?? 0).toFixed(2)
										}
									})})
								{:else}
									({$_('archive.creditsEstimated')})
								{/if}
							{:else}
								· {$_('archive.creditsNoRate')}
							{/if}
							<button
								type="button"
								class="ml-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
								on:click={() => refreshCredits()}>{$_('archive.creditsRefresh')}</button
							>
						{:else}
							{$_('archive.creditsUnknown')}
						{/if}
					</p>
					{#if !persistent}
						<p class="mt-2 text-xs text-faint" data-testid="archive-memory-hint">
							{$_('archive.memoryHint')}
						</p>
					{/if}
					<p class="mt-2 text-xs text-faint">
						{$_('archive.alephCredits', { values: { channel: ALEPH_CHANNEL } })}
						<a
							class="underline"
							href="https://app.aleph.cloud"
							target="_blank"
							rel="noopener noreferrer">app.aleph.cloud</a
						>
					</p>
				{/if}
			</div>
		{/if}

		{#if $archiveStore.unlocked}
			<dl
				class="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4"
				data-testid="archive-status"
			>
				<dt class="text-faint">{$_('archive.sequence')}</dt>
				<dd data-testid="archive-sequence">{$archiveStore.sequence}</dd>
				<dt class="text-faint">{$_('archive.pending')}</dt>
				<dd data-testid="archive-pending">{$archiveStore.pending}</dd>
				<dt class="text-faint">{$_('archive.lastShipped')}</dt>
				<dd data-testid="archive-last">
					{#if $archiveStore.lastShipped}
						{when($archiveStore.lastShipped.at)} · {kb($archiveStore.lastShipped.bytes)} ·
						{$_('archive.entries', { values: { count: $archiveStore.lastShipped.entries } })}
						{#if !$archiveStore.lastShipped.kept}· {$_('archive.notKept')}{/if}
					{:else}
						—
					{/if}
				</dd>
				<dt class="text-faint">{$_('archive.failures')}</dt>
				<dd data-testid="archive-failures">{$archiveStore.failures}</dd>
			</dl>

			<div class="mb-3 flex flex-wrap gap-2">
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
					on:click={onFlush}
					disabled={!canAct || !$archiveStore.running}
					data-testid="archive-flush">{$_('archive.flush')}</button
				>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
					on:click={onList}
					disabled={!canAct || !secretStored}
					data-testid="archive-list">{$_('archive.list')}</button
				>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
					on:click={onRestore}
					disabled={!canAct || !secretStored}
					data-testid="archive-restore">{$_('archive.restore')}</button
				>
			</div>

			{#if $archiveStore.increments}
				<ul class="mb-3 space-y-1 text-xs" data-testid="archive-increments">
					{#if $archiveStore.increments.length === 0}
						<li class="text-faint">{$_('archive.none')}</li>
					{/if}
					{#each $archiveStore.increments as item (item.id)}
						<li class="flex flex-wrap gap-2">
							<code class="font-mono break-all">{item.id.slice(0, 16)}…</code>
							{#if item.time}<span class="text-faint">{new Date(item.time).toLocaleString()}</span
								>{/if}
							{#if item.size}<span class="text-faint">{kb(item.size)}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if $archiveStore.restored}
				<p class="mb-2 text-sm" data-testid="archive-restored">
					{$_('archive.restoredSummary', {
						values: {
							increments: $archiveStore.restored.increments,
							joined: $archiveStore.restored.joined,
							skipped: $archiveStore.restored.skipped
						}
					})}
					{#if $archiveStore.restored.copied}
						<span class="block text-xs text-faint" data-testid="archive-restored-copied"
							>{$_('archive.restoredCopied', {
								values: { count: $archiveStore.restored.copied }
							})}</span
						>
					{/if}
				</p>
			{/if}
		{/if}

		{#if $archiveStore.progress}
			{@const p = $archiveStore.progress}
			{@const share = p.total > 0 ? Math.round((p.done / p.total) * 100) : null}
			<div class="mb-3" data-testid="archive-progress" data-stage={p.stage}>
				<div class="mb-1 flex justify-between text-xs text-faint">
					<span
						>{$_(`archive.progress.${p.stage}`, { values: { done: p.done, total: p.total } })}</span
					>
					{#if share != null}<span data-testid="archive-progress-share">{share} %</span>{/if}
				</div>
				<div
					class="h-2 w-full overflow-hidden rounded bg-surface-2"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={share ?? undefined}
				>
					<div
						class="h-full rounded bg-coral-500 transition-[width] duration-300"
						class:animate-pulse={share == null}
						style={`width: ${share ?? 100}%`}
					></div>
				</div>
			</div>
		{/if}

		{#if localError || $archiveStore.lastError}
			<p class="text-sm text-danger" data-testid="archive-error">
				{#if $archiveStore.lastError === 'prf-unavailable'}{$_(
						'archive.prfUnavailable'
					)}{:else}{localError ?? $archiveStore.lastError}{/if}
			</p>
		{/if}

		<p class="mt-3 text-xs text-faint">{$_('archive.prompts')}</p>
	{/if}
</section>
