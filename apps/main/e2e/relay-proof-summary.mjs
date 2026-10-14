// Adds up the runs of e2e/relay-proof-mode.bench.js (#64), one row per mode.
//
//   node e2e/relay-proof-summary.mjs [results dir]
import { readdir, readFile } from 'node:fs/promises';

const dir = process.argv[2] ?? new URL('./results/', import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => /^relay-proof-.*\.json$/.test(f)).sort();
if (files.length === 0) {
	console.log(`No relay-proof-*.json in ${dir}`);
	process.exit(0);
}

/** @param {number[]} xs */
const quantile = (xs, q) => {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const ms = (v) => (v == null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** @type {Record<string, { runs: number, todos: number, pinned: number, unavailable: number, unknown: number, settle: number[], arrival: number[], arrived: number, bobPinned: number, resets: number[], met: number, entryCounts: number[] }>} */
const byMode = {};
for (const file of files) {
	const r = JSON.parse(await readFile(`${dir}/${file}`, 'utf8'));
	const m = (byMode[r.mode] ??= {
		runs: 0,
		todos: 0,
		pinned: 0,
		unavailable: 0,
		unknown: 0,
		settle: [],
		arrival: [],
		arrived: 0,
		bobPinned: 0,
		resets: [],
		met: 0,
		entryCounts: []
	});
	m.runs++;
	if (r.setup?.peersMet) m.met++;
	m.resets.push((r.errors?.alice?.streamResets ?? 0) + (r.errors?.bob?.streamResets ?? 0));
	// `/pinning/databases` answers a list, or an object holding one.
	const listing = r.relayAfter?.databases;
	const rows = Array.isArray(listing) ? listing : (listing?.databases ?? []);
	const counts = rows.map((d) => d?.entryCount).filter((n) => typeof n === 'number');
	if (counts.length) m.entryCounts.push(Math.max(...counts));
	for (const t of r.todos ?? []) {
		m.todos++;
		const final = t.alice?.final;
		if (final === 'pinned') {
			m.pinned++;
			m.settle.push(t.alice.settledMs);
		} else if (final === 'unavailable') m.unavailable++;
		else m.unknown++;
		if (t.bob?.arrivedMs != null) {
			m.arrived++;
			m.arrival.push(t.bob.arrivedMs);
		}
		if (t.bob?.chip?.final === 'pinned') m.bobPinned++;
	}
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '—');
console.log(
	'| mode | runs | peers met | todos | pinned (Alice) | time to pinned median / p95 | unavailable | unknown | reached Bob | arrival median / p95 | Bob chip pinned | resets per run median | relay entryCount median |'
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [mode, m] of Object.entries(byMode)) {
	console.log(
		`| ${mode} | ${m.runs} | ${m.met}/${m.runs} | ${m.todos} | ${m.pinned} (${pct(m.pinned, m.todos)}) | ${ms(quantile(m.settle, 0.5))} / ${ms(quantile(m.settle, 0.95))} | ${m.unavailable} | ${m.unknown} | ${m.arrived} (${pct(m.arrived, m.todos)}) | ${ms(quantile(m.arrival, 0.5))} / ${ms(quantile(m.arrival, 0.95))} | ${m.bobPinned} | ${quantile(m.resets, 0.5) ?? '—'} | ${quantile(m.entryCounts, 0.5) ?? '—'} |`
	);
}
console.log(`\n${files.length} runs read from ${dir}`);
