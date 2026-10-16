<script>
	// Between two passkey prompts: what the next touch is for, and "Continue"
	// starts it (passkey-steps.js). Escape cancels like "Cancel".
	import { passkeyStep, PasskeyStepCancelled } from '$lib/passkey-steps.js';
	import { _ } from '$lib/i18n/index.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog;
	$: step = $passkeyStep.step;
	$: if (dialog) {
		if (step && !dialog.open) dialog.showModal();
		else if (!step && dialog.open) dialog.close();
	}

	const cancel = () => $passkeyStep.reject?.(new PasskeyStepCancelled());
</script>

<dialog
	bind:this={dialog}
	on:cancel|preventDefault={cancel}
	aria-labelledby="passkey-step-h"
	class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-xl border border-border bg-surface p-5 text-text shadow-2xl backdrop:bg-black/55"
	data-testid="passkey-step-dialog"
>
	{#if step}
		<p
			class="text-xs font-semibold tracking-wide text-faint uppercase"
			data-testid="passkey-step-count"
		>
			{$_('passkeySteps.count', { values: { n: step.n, of: step.of } })}
		</p>
		<h2 id="passkey-step-h" class="mt-1 text-lg font-semibold text-heading">
			{$_(`passkeySteps.${step.purpose}.title`)}
		</h2>
		<p class="mt-2 text-sm leading-relaxed">{$_(`passkeySteps.${step.purpose}.why`)}</p>
		<p class="mt-2 text-sm leading-relaxed text-faint">{$_('passkeySteps.notALoop')}</p>
		<div class="mt-4 flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface-2"
				on:click={cancel}
				data-testid="passkey-step-cancel">{$_('passkeySteps.cancel')}</button
			>
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				class="min-h-11 rounded-md bg-coral-500 px-4 text-sm font-medium text-white hover:bg-coral-600"
				on:click={() => $passkeyStep.resolve?.()}
				autofocus
				data-testid="passkey-step-continue">{$_('passkeySteps.continue')}</button
			>
		</div>
	{/if}
</dialog>
