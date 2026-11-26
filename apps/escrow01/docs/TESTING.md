# Testing Guide

The test suite runs locally with Playwright's Chromium project. The configured
web server starts the app and its local relay automatically.

## Setup

Install dependencies and Chromium:

```bash
pnpm install
pnpm exec playwright install chromium
```

## Commands

Run unit tests (vitest, in a headless Chromium):

```bash
pnpm run test:unit
```

Run the end-to-end specs CI runs. They are listed in `chapter.json` under
`ci.specs`; the CI workflow reads that list, so it is the one to keep current:

```bash
pnpm exec playwright test $(node -e "console.log(require('./chapter.json').ci.specs.join(' '))") --project=chromium
```

`pnpm run test:e2e` runs every spec file in `e2e/`, including the ones CI
leaves out (below).

Run only consent-screen tests:

```bash
pnpm run test:consent
```

Each chapter has its own ports (`chapter.json` → `ports`), so two chapters can
run side by side. To run two suites of the same chapter at once, give the
second one other ports through `E2E_PREVIEW_PORT`, `E2E_RELAY_HTTP_PORT`,
`E2E_RELAY_TCP_PORT`, `E2E_RELAY_WS_PORT`, `E2E_RELAY_WEBRTC_PORT` and
`E2E_RELAY_WEBRTC_DIRECT_PORT`. `E2E_RELAY_CLI_PATH` points the local E2E
server at another relay build; `E2E_RELAY_MODE=public` uses a public relay
instead of starting one.

## Budgets and the escrow

What this chapter adds is tested on three levels:

- **Unit tests** (`pnpm run test:unit`): the budget rules (`src/lib/budget/budget.spec.js`),
  locking and releasing step by step (`budget-flow.spec.js`), the in-memory
  fake (`budget-service-fake.spec.js`), the Sepolia service against a stand-in
  chain, including which passkey prompt comes when (`budget-service-zama.spec.js`),
  and the chain helpers (`src/lib/chain/*.spec.js`).
- **End-to-end** against the fake: `e2e/budget.spec.js` creates a todo with a
  delegate and an amount, watches it lock and releases it, and checks that
  amounts behind a sealed read key stay hidden until the passkey shows them;
  `e2e/private-start.spec.js` checks that a start without a link ends in the
  private list the first todo makes, and that three words from a link open
  the shared list. No spec talks to Sepolia.
- **The contract**: `cd contracts && npm ci && npm test` runs 16 Hardhat tests
  in FHEVM mock mode. The Sepolia smoke tests (`npm run smoke:sepolia:dry`,
  `npm run smoke:sepolia`) are in [contracts/README.md](../contracts/README.md#sepolia-runbook).

## Specs CI leaves out

`manual-multiaddr-connection.spec.js`, inherited from `main`, joined `ci.specs` after it passed on
`main` and on the refactor branch (2026-11-25). `shared-list-mnemonic.spec.js` and
`passkey-identity.spec.js` joined it the same day. The private start (#140) had turned both red, each
for a reason of its own, and the passkey spec also raced its own writes. All three are described
below.

| Spec                                | Why it is not in `ci.specs`                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `relay-button-provisioning.spec.js` | deploys a real relay through the Relay Button, with an Aleph account |
| `relay-button-drag.spec.js`         | the Relay Button's own behaviour, covered in its repository          |
| `remote-main-local.spec.js`         | drives a deployed site (`e2e/remote/`), not the local build          |

The mnemonic spec has Alice join fresh three Spanish words in her start dialog
(**Settings** → **Join a shared list**). It copies them from her **Lists** tab into
Bob's start dialog, proves both derive the same OrbitDB address, verifies
bidirectional replication, and confirms that a third browser using another
mnemonic remains isolated. Alice has to join on purpose. A start without words
ends in the private list her first todo makes. Her browser's own three-word list
is open only underneath, even though the **Lists** tab shows its words in the
meantime, so a todo never reaches the list Bob joined:

```bash
pnpm exec playwright test e2e/shared-list-mnemonic.spec.js --project=chromium
```

The passkey spec, from `passkey01`, gives Alice and Bob a passkey each in a
virtual authenticator. Both join the same shared list. Each waits until the
light under the list's name shows the other browser, and only then writes. A
todo travels as a live update on the list's topic, and one published before the
other browser is on that topic is not sent again. Both then see each other's
todos with the author's DID. Then Alice reloads and signs in again: her DID is the
same, and she is back in the shared list with her todo. She gets back there
because the start keeps the words it joined (`rememberJoined` in
[`src/lib/start/three-words.js`](../src/lib/start/three-words.js)). Before
that, a reload read them as the browser's own words and ended in her private
list. In memory mode nothing is kept across a reload, so there it still does:

```bash
pnpm exec playwright test e2e/passkey-identity.spec.js --project=chromium
```

## Per-todo delegation (from `delegation01`)

The rules — who may act on a delegated todo, and how revoke and
expiry fold a delegate's actions back out — are pure functions in
`src/lib/delegation.js`, covered by `src/lib/delegation.spec.js`
(`pnpm run test:unit`, runs in a headless Chromium through vitest).

The browser proof is `e2e/delegation.spec.js`: three passkey identities
(Alice, Bob, Mallory) in separate contexts with virtual authenticators. It
checks that only the delegate's row is writable, that a delegated completion
and rename replicate to the owner, that the passkey prompt happened (the
`delegated-auth-state` badge), and the revoke and expiry paths. Three more
cases, each of which would have to arrive from the relay, are marked
`test.fixme`: a delegation and a revocation made while the delegate is offline
(measured locally 4 of 6 and 6 of 6; why the delegation sometimes does not
arrive is not established), and a delegate's completion made while the owner
is offline, which the relay refuses
([foundations.md](foundations.md#-per-todo-delegation-from-delegation01), "What the relay makes of a delegate's entries").
The comments in the spec have the runs.

```bash
pnpm exec playwright test e2e/delegation.spec.js --project=chromium
```

## Debugging

Open Playwright UI mode:

```bash
pnpm exec playwright test --ui --project=chromium
```

Run headed with the Playwright Inspector:

```bash
PWDEBUG=1 pnpm exec playwright test --project=chromium --headed
```

Show the last HTML report:

```bash
pnpm exec playwright show-report
```

Screenshots are captured on failure, videos are retained on failure, and a
trace is collected on the first retry.

## A relay for `pnpm dev`

In development the app reads `VITE_RELAY_BOOTSTRAP_ADDR_DEV` from `.env`. If that variable is not set, it falls back to a hardcoded localhost relay address, so the safest local workflow is:

1. Start an `orbitdb-relay` process.
2. Copy its WebSocket multiaddr into `.env`.
3. Start or restart the Vite dev server.

Install and run the published npm package:

```bash
npm install -g orbitdb-relay

ENABLE_GENERAL_LOGS=1 \
RELAY_LISTEN_IPV4=127.0.0.1 \
RELAY_DISABLE_IPV6=true \
RELAY_DISABLE_QUIC=true \
RELAY_DISABLE_WEBRTC=true \
DATASTORE_PATH=/tmp/simple-todo-orbitdb-relay \
orbitdb-relay --test
```

The relay exposes helper routes on `http://127.0.0.1:9090`. In another terminal, fetch the browser-dialable WebSocket address:

```bash
curl -s http://127.0.0.1:9090/multiaddrs | node -e "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => { const j = JSON.parse(d); console.log(j.best.websocket || j.byTransport.websocket[0]); });"
```

Use exactly one printed `/ws` address. Do not paste the raw TCP address on port `9091`, and do not include quotes, commas, or multiple addresses in one value.

Put the printed address in `.env`. If you copied `.env.example`, replace the existing `VITE_RELAY_BOOTSTRAP_ADDR_DEV` value:

```bash
VITE_RELAY_BOOTSTRAP_ADDR_DEV=/ip4/127.0.0.1/tcp/9092/ws/p2p/<relay-peer-id>
```

Then start the app:

```bash
pnpm dev
```

If you change `.env` while Vite is already running, restart `pnpm dev` so the new relay address is loaded.
