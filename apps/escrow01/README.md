# escrow01 · Confidential budgets for delegated todos

[![Deploy](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml?query=branch%3Amain)
[![CI](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml?query=branch%3Amain)

A todo app that runs in the browser, with no server holding the data. The owner of a todo hands it to
someone else and locks a budget for it; once it is done, the owner releases the money. The amount is
encrypted with Zama's FHEVM: the chain shows who locked money for whom and when, never how much. The
todos are sealed in the browser: the relay that keeps a list, and anyone who has its address, hold
envelopes. One passkey signs in, signs the list's entries and pays. [Deutsch](README.de.md)

This is the `escrow01` chapter of the [Simple-Todo tutorial](../../README.md). It builds on
[`delegation01`](../delegation01) and adds the escrow: a smart contract, an account per passkey and a
confidential token, on the Sepolia test network.

## Try it

**Live:** [escrow01.le-space.de](https://escrow01.le-space.de/) (German) ·
[escrow01.le-space.de/en/](https://escrow01.le-space.de/en/) (English). Sepolia testnet: no real
money moves.

1. Press **Create a passkey and start**. You start in a private list of your own, "My todos", which
   your first todo creates.
2. Add a todo, tick **Delegate this todo to another DID**, paste the other person's **Passkey DID**
   (their **Account** tab) and enter a budget.
3. Send them the list's link: the address bar carries it, and so does the QR code in the header.
   They read only the todo handed to them, tick it as done, and you release the budget. The
   **Account** tab opens the auditor view.

A presenter's script with the questions experts ask is in [docs/demo.md](docs/demo.md)
([Deutsch](docs/demo.de.md)).

## What is real, and what is a demo

| Part            | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amounts         | encrypted in the browser and on chain; the owner, the delegate and one auditor can decrypt them                                                                                                                                                                                                                                                                                                                                                                         |
| Todos and lists | a list of one's own is **sealed** in the browser: the relay and anyone with its address hold envelopes and see only who wrote when and who may write. The owner and the people she lets write read it; a delegate reads only the todo handed to them. A key handed out cannot be taken back: removing someone starts a new epoch, and they keep what they could read until then. The list behind three words stays open ([sealed lists](docs/security.md#sealed-lists)) |
| The contract    | [`ConfidentialTodoEscrow`](contracts/src/ConfidentialTodoEscrow.sol) on Sepolia at [`0x6Ee3…3429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code), verified on Etherscan, Sourcify and Blockscout                                                                                                                                                                                                                                |
| The money       | Zama's test token cUSDTMock; an account's first lock mints it 1,000.00. Openfort pays the gas                                                                                                                                                                                                                                                                                                                                                                           |
| The auditor     | one address fixed in the contract, which can read every amount. Fine for a demo, not for a product ([security](docs/security.md))                                                                                                                                                                                                                                                                                                                                       |
| The passkey     | the DID, the list signing key, the key for sealed lists and the account all hang on it, and the two keys for the list are derived at every start, never stored. A first start asks 3 times, plus once on Sepolia to seal the key that reads amounts; a return asks once, a device that kept nothing 4 times ([how often](docs/passkey-account.md#how-often-the-passkey-asks), [four keys](docs/keys.md))                                                                |
| Without Sepolia | a build without the Sepolia settings uses an in-memory fake: nothing is encrypted or sent, an amount can be read only in the tab that locked it, and the **Account** tab says \"Demo without a chain\". The tests run against it                                                                                                                                                                                                                                        |

It is a demo on a test network, built to teach and to show. It is not ready for production use; what
is missing is listed under the open issues in [docs/security.md](docs/security.md).

## Run it

```bash
git clone https://github.com/Le-Space/simple-todo.git
cd simple-todo
pnpm install
cd apps/escrow01
pnpm dev
```

- **Sepolia:** put the settings from [Configuration](docs/passkey-account.md#configuration) into
  `.env.local` and start again. A delegate needs an account before a budget can be locked for them;
  it is set up on its own after their first start.
- **A relay for `pnpm dev`:** [docs/TESTING.md](docs/TESTING.md#a-relay-for-pnpm-dev).
- **Tests:** `pnpm run test:unit`; the browser specs CI runs are listed in `chapter.json` →
  `ci.specs` ([docs/TESTING.md](docs/TESTING.md)).
- **The contract:** `cd contracts && npm ci && npm test` runs 16 tests in FHEVM mock mode;
  `npm run smoke:sepolia:dry` checks the Sepolia deployment and needs only an RPC URL
  ([runbook](contracts/README.md#sepolia-runbook)).

## Where the escrow lives in the code

| Step                                                        | Files                                                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The escrow on chain                                         | [`contracts/src/ConfidentialTodoEscrow.sol`](contracts/src/ConfidentialTodoEscrow.sol)                                                                            |
| A budget's states, as pure functions                        | [`src/lib/budget/budget.js`](src/lib/budget/budget.js)                                                                                                            |
| One interface for every budget operation, and its two sides | [`budget-service.js`](src/lib/budget/budget-service.js), [`-fake.js`](src/lib/budget/budget-service-fake.js), [`-zama.js`](src/lib/budget/budget-service-zama.js) |
| Lock and release, step by step                              | [`budget-flow.js`](src/lib/budget/budget-flow.js), [`budget-store.js`](src/lib/budget/budget-store.js)                                                            |
| Sepolia, Calibur, Zama's SDK                                | [`src/lib/chain/`](src/lib/chain)                                                                                                                                 |
| The start: one passkey, a private list of one's own         | [`src/routes/+page.svelte`](src/routes/+page.svelte), [`src/lib/start/`](src/lib/start), [`home-list.js`](src/lib/home-list.js)                                   |
| Sealed lists: envelopes, keys, epochs                       | [`src/lib/sealed/`](src/lib/sealed), [`identity-blocks.js`](src/lib/identity-blocks.js), [`newcomers.js`](src/lib/newcomers.js)                                   |

Read them in the order of the [code tour](docs/code-tour.md), which also follows one lock from the
form to the chain.

## What it builds on

Per-todo delegation from `delegation01`, per-DID write permissions from `acl01`, passkey identities
from `passkey01` and shared lists by three words from `collab01`: each with its walkthrough in
[docs/foundations.md](docs/foundations.md). Underneath: libp2p, Helia, OrbitDB and Svelte, all in the
browser.

## Read more

- [docs/code-tour.md](docs/code-tour.md): the code in reading order, and one lock end to end
- [docs/escrow.md](docs/escrow.md): roles, lifecycle, `todoRef`, what is public and what is encrypted
- [docs/passkey-account.md](docs/passkey-account.md): the passkey's account (Calibur), gas sponsoring,
  where amounts are encrypted and decrypted, and how often the passkey asks, with sequence diagrams
- [docs/keys.md](docs/keys.md): the four keys behind one passkey, why the read key exists, what Zama
  v0.14 changes about it, and how we proceed
- [docs/zama-confidential-transactions.md](docs/zama-confidential-transactions.md): Zama's protocol as
  used here, from handles to threshold decryption
- [docs/money-flow.md](docs/money-flow.md): where the test money comes from, whose token contracts
  these are, and what of a lock and a release is public
- [docs/smoke-test.md](docs/smoke-test.md): the Sepolia run of 2026-09-16, step by step
- [docs/security.md](docs/security.md): threat model, leaks, trust assumptions, sealed lists, open
  issues
- [docs/demo.md](docs/demo.md): the presenter's script
- [docs/foundations.md](docs/foundations.md): what the chapter inherits from the chapters before it
- [docs/TESTING.md](docs/TESTING.md): unit, browser and contract tests, and a relay for development
- [contracts/README.md](contracts/README.md): toolchain, deployment, verification, smoke test
- [e2e-video/README.md](e2e-video/README.md): how the demo film is recorded

Every page in `docs/` has a German version next to it as `*.de.md`, except `TESTING.md`.

## License

This project is open source and available under the [LICENSE](./LICENSE) file.
