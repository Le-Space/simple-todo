<script>
	import { createEventDispatcher } from 'svelte';
	import TodoItem from './TodoItem.svelte';
	import { todoReplicationStatusStore, sealedHiddenStore } from './db-actions.js';
	import { _ } from '$lib/i18n/index.js';

	/** @typedef {{ id: string, text: string, completed: boolean, assignee: string | null, createdBy: string, author?: string, key: string }} TodoItemData */

	/** @type {TodoItemData[]} */
	export let todos = [];
	export let title = 'TODO Items';
	export let emptyMessage = 'No TODOs yet. Add one above!';

	const dispatch = createEventDispatcher();

	/**
	 * @param {CustomEvent<{ key: string }>} event
	 */
	function handleDelete(event) {
		dispatch('delete', event.detail);
	}

	/**
	 * @param {CustomEvent<{ key: string }>} event
	 */
	function handleToggleComplete(event) {
		dispatch('toggleComplete', event.detail);
	}
</script>

<div class="mb-6 rounded-lg bg-surface p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({todos.length})</h2>
	{#if todos.length > 0}
		<div class="space-y-3">
			{#if $sealedHiddenStore > 0}
				<li
					class="mb-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-faint"
					data-testid="sealed-hidden"
				>
					🔒 {$_('todo.sealedHidden', { values: { count: $sealedHiddenStore } })}
				</li>
			{/if}
			{#each todos as { id, text, completed, assignee, createdBy, author, key } (key)}
				<TodoItem
					{id}
					{text}
					{completed}
					{assignee}
					{createdBy}
					{author}
					replicationStatus={$todoReplicationStatusStore[key] ?? 'unknown'}
					todoKey={key}
					on:delete={handleDelete}
					on:toggleComplete={handleToggleComplete}
				/>
			{/each}
		</div>
	{:else}
		<p class="py-8 text-center text-faint">{emptyMessage}</p>
	{/if}
</div>
