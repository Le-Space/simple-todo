# Does the relay replicate a todo without being asked to?

The relay chip on every todo is fed by a proof: after a write, the app asks the
relay whether it holds the entry. Until now the proof also _told_ the relay to
run a fresh pass over the database (`POST /pinning/sync`) on every round, and
restarted the local Sync to nudge it. Whether the relay would have replicated
the todo on its own was never measured. [#64](https://github.com/Le-Space/simple-todo/issues/64)
asks exactly that; this is the answer, from `e2e/relay-proof-mode.bench.js`
(see [TESTING.md](TESTING.md#the-relay-proof-experiment-64)).

Two arms, one build. `sync` is today's proof. `observe` never asks the relay for
anything; it only reads `POST /pinning/has-entry` within the same 60 s budget.
Two browsers share the default list through the relay; Alice writes five todos
one at a time; for each one the chip's settle time in both browsers, the time
until Bob has the todo, and the pages' stream resets are recorded. The raw
numbers are in `e2e/results/`.

## Local relay, 2026-10-14

orbitdb-relay built from `main` with [#60](https://github.com/NiKrause/orbitdb-relay/pull/60),
a fresh datastore per run. Twenty runs, ten per arm, alternating
(observe, sync, sync, observe), on an otherwise idle Apple M-series laptop.

| mode    | runs  | todos | pinned (Alice) | time to pinned, median / p95 | reached Bob | arrival, median / p95 | Bob's chip pinned | stream resets |
| ------- | ----- | ----- | -------------- | ---------------------------- | ----------- | --------------------- | ----------------- | ------------- |
| observe | 10/10 | 50    | 50 (100 %)     | **590 ms** / 1.8 s           | 50 (100 %)  | 313 ms / 531 ms       | 50                | 0             |
| sync    | 10/10 | 50    | 50 (100 %)     | **5.7 s** / 5.8 s            | 50 (100 %)  | 308 ms / 360 ms       | 50                | 0             |

What it says:

- **The relay replicates on its own.** In every `observe` run the relay joined
  the database from the browsers' topic subscription alone (its `/pinning/stats`
  counted the syncs) and held each todo within 0.6 s of the write — 1.8 s at the
  95th percentile, which is the first todo of a run, while the relay opens the
  database.
- **The forced pass costs ten times the time and buys nothing here.** With
  `sync`, every todo took 5.4–5.9 s to prove: the relay's fresh pass (open,
  re-dial the subscribers, wait for an update) and the browser's `sync.stop()`/
  `sync.start()` sit in front of an answer the relay could already give. The
  spread is narrow because the cost is the pass itself, not the network.
- **Replication between the browsers is untouched.** Bob had every todo after
  about 0.3 s in both arms; gossipsub carries that, not the relay's pass.
- **No resets.** Against a relay with #60 neither arm produced a
  `StreamResetError`; before #60 the `sync` arm would have hung up on both
  browsers on every proof.

One difference in the relay's own account: after `observe` runs its listing
reports `entryCount: null` with `snapshotSource: "update-event burst only"`,
after `sync` runs `entryCount: 5` — the fresh pass is what fills that field.
The proof does not use it; `has-entry` answered the same either way.

## Production relay, 2026-10-14

The Le Space relay on Aleph, reached from two browsers on one laptop
(`E2E_RELAY_MODE=public`). Two relays were measured: the VM that had run since
August (orbitdb-relay 0.10.7, which hangs up on every browser during a fresh
pass — so only `observe` could be run against it), and the VM deployed that
morning from `main` (0.10.10, with #60), both arms, twelve runs alternating.

| relay   | mode    | runs | todos | pinned (Alice) | time to pinned, median / p95 | first todo median | later todos median | reached Bob | arrival median | stream resets |
| ------- | ------- | ---- | ----- | -------------- | ---------------------------- | ----------------- | ------------------ | ----------- | -------------- | ------------- |
| 0.10.7  | observe | 3/3  | 15    | 15 (100 %)     | 860 ms / 8.8 s               | 7.7 s             | 859 ms             | 15 (100 %)  | 324 ms         | 1             |
| 0.10.10 | observe | 6/6  | 30    | 30 (100 %)     | 858 ms / 1.4 s               | 1.1 s             | 852 ms             | 30 (100 %)  | 322 ms         | 0             |
| 0.10.10 | sync    | 6/6  | 30    | 21 (70 %)      | 5.7 s / 6.1 s                | 6.0 s             | 5.6 s              | 20 (67 %)   | 322 ms         | 0             |

What it says:

- **The same shape as locally, one network round trip wider.** `observe` proves
  a todo in 0.86 s against a relay on the other side of the internet; `sync`
  takes 5.7 s for the same answer. Bob has every todo after 0.32 s either way.
- **The first todo of a run costs the first write, not the proof.** Against the
  old relay the chip of the first todo appeared only 7–8 s after the click:
  that is how long the first `put` on the default list took there, and Bob
  received it just as late. Against the fresh VM the first todo settled in 1.1 s.
- **Two `sync` runs never got online.** In the second and third run of the
  twelve — both `sync`, both right after the first — neither browser reached
  the relay or the other browser within 90 s, so nothing could be proven or
  replicated; the relay was up throughout, and the fourth run (`observe`,
  minutes later) connected in 26 s like the rest. Those nine `unknown` todos are
  the whole difference between 70 % and 100 % for `sync`; the mode cannot cause
  a connection failure that happens before the first write. What did is not
  known; it is recorded here rather than dropped.
- **No hang-ups.** With 0.10.10 the `sync` arm produced no stream reset in
  four connected runs. Against 0.10.7 it was not run: that relay hangs up on
  every browser during the fresh pass (#59).

## What follows

The relay replicates a todo on its own, locally and in production, and the
proof's `POST /pinning/sync` only delays the answer. Step 2 of #64 — the chip
asking bitswap who holds the entry, and no REST call from the chapters — can
go ahead. The raw numbers are in `e2e/results/`; `node e2e/relay-proof-summary.mjs`
prints the table above (local and production runs share labels, the table
tells them apart by relay).
