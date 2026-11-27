# A tour of the code

For a developer who reads `escrow01` as a step of the tutorial: what the chapter adds to
`delegation01`, in the order it is easiest to read, and how one lock travels from the form to the
chain. What it inherits is in [foundations.md](foundations.md). German:
[code-tour.de.md](code-tour.de.md).

## Reading order

The chapter keeps its escrow apart from everything else, so it can be read on its own. Most of it
sits behind one interface; read that, then one side of it, then the other.

| #   | File                                                                                                                                                                                                                                                                                                                                                                     | What it teaches                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol)                                                                                                                                                                                                                                                                                | the escrow on chain: `lock`, `release`, `refund`, `escrowOf`; an encrypted amount (`euint64`) per creator and `todoRef`; who may decrypt it (`FHE.allow`)                                                                                                               |
| 2   | [`src/lib/budget/budget.js`](../src/lib/budget/budget.js)                                                                                                                                                                                                                                                                                                                | a todo's `budget` field and its states, as pure functions: OrbitDB holds the status and references, never the amount                                                                                                                                                    |
| 3   | [`src/lib/budget/budget-service.js`](../src/lib/budget/budget-service.js)                                                                                                                                                                                                                                                                                                | the one interface every budget operation goes through, and which implementation `VITE_BUDGET_SERVICE` picks                                                                                                                                                             |
| 4   | [`src/lib/budget/budget-service-fake.js`](../src/lib/budget/budget-service-fake.js)                                                                                                                                                                                                                                                                                      | the interface in memory: the contract's rules without a chain, what the tests and a build without Sepolia use                                                                                                                                                           |
| 5   | [`src/lib/budget/budget-flow.js`](../src/lib/budget/budget-flow.js)                                                                                                                                                                                                                                                                                                      | a lock and a release step by step, each step written to the todo before the next starts                                                                                                                                                                                 |
| 6   | [`src/lib/budget/budget-store.js`](../src/lib/budget/budget-store.js)                                                                                                                                                                                                                                                                                                    | the session's service, decrypted amounts kept in memory only, the account's status, the payout watch                                                                                                                                                                    |
| 7   | [`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js)                                                                                                                                                                                                                                                                                      | the same interface on Sepolia: the passkey's account, encryption in the browser, the read key and its seal                                                                                                                                                              |
| 8   | [`src/lib/chain/`](../src/lib/chain)                                                                                                                                                                                                                                                                                                                                     | how, not what: `sepolia-chain.js` (RPC, user operations, Calibur), `zama-client.js` (Zama's SDK), `account-directory.js` (which account belongs to a DID), `account-store.js` and `read-key-seal.js` (what this browser keeps, and sealed how), `config.js` (addresses) |
| 9   | [`src/lib/AddTodoForm.svelte`](../src/lib/AddTodoForm.svelte), [`TodoItem.svelte`](../src/lib/TodoItem.svelte), [`BudgetChip.svelte`](../src/lib/budget/BudgetChip.svelte), [`BudgetNotices.svelte`](../src/lib/budget/BudgetNotices.svelte), [`BalanceCard.svelte`](../src/lib/budget/BalanceCard.svelte), [`AuditorView.svelte`](../src/lib/budget/AuditorView.svelte) | the budget on screen: the field in the form, the chip on the row, what went wrong, the balance, the auditor view                                                                                                                                                        |
| 10  | [`src/lib/explanations/`](../src/lib/explanations), [`TechnicalExplanation.svelte`](../src/lib/TechnicalExplanation.svelte)                                                                                                                                                                                                                                              | every step explained twice: simply, and in detail when "Technical" is on                                                                                                                                                                                                |
| 11  | [`src/routes/+page.svelte`](../src/routes/+page.svelte), [`src/lib/start/`](../src/lib/start), [`home-list.js`](../src/lib/home-list.js)                                                                                                                                                                                                                                 | the start: one passkey (`start` and `beginWith` on the page, `passkeyPromptsFor` in `start/identity.js`) and a private list of one's own (`openStartList` on the page, `openHomeList` in `home-list.js`)                                                                |

Where escrow code sits in an inherited file, it is usually marked with an `escrow01:` comment. The
page keeps the start's flow; the parts that need nothing from its state sit beside it in
[`src/lib/start/`](../src/lib/start) and [`src/lib/sections/`](../src/lib/sections) (the header,
the Account and the Network tab). [`src/lib/relay-proof.js`](../src/lib/relay-proof.js) is inherited
and not part of the lesson: the mark that says the relay confirmed a todo's entry, asked over a relay route that is
deprecated.

## How a lock travels

Alice adds a todo delegated to Bob with 500.00 in the budget field:

1. `handleAddTodo` in `+page.svelte` first creates her private list if the start only pointed to it
   (`openHomeList(…, { create: true })`), then calls `addTodoWithBudget` in `budget-store.js`.
2. `prepareLock` in `budget-flow.js` asks the service for a `todoRef` and returns a budget in the
   state "locking". The amount stays in the store's memory (`rememberAmount`).
3. `addTodo` in `db-actions.js` writes the todo with that budget to OrbitDB. The list now shows
   "being locked"; the form is free again.
4. `lockBudget` runs on in the background: `finishLock` calls the service's `lock`, which asks the
   passkey. On Sepolia that is one user operation: the browser encrypts 500.00 for the escrow and
   Alice's account, Openfort pays the gas, and the escrow stores the encrypted amount.
5. `finishLock` writes the outcome to the todo ("locked", or the error), and `BudgetNotices`
   explains a failure. Bob's browser receives the todo through OrbitDB and reads the amount through
   the service's decrypt, never from the todo.

A release goes the same way: `releaseTodoBudget` → `releaseBudgetOf` → the service's `release`,
each step written to the todo. The details on chain are in
[passkey-account.md](passkey-account.md#locking-a-budget-where-encryption-happens) and
[escrow.md](escrow.md).

## What the chapter does

The long form of what the [README](../README.md) says in a table.

Built on `delegation01`. A delegated todo can carry a budget: the owner locks an amount of a
confidential token for the delegate, releases it when the todo is done, or takes it back after a
deadline. The amount is encrypted with Zama's FHEVM, so the chain shows who locked money for whom and
when, but not how much. The owner, the delegate and one auditor fixed in the contract can decrypt it;
the exceptions and the trust in Zama's key holders are in [security.md](security.md). This is
the escrow half of [de2do](https://github.com/NiKrause/de2do).

- **The contract is live.** [`ConfidentialTodoEscrow`](../contracts/src/ConfidentialTodoEscrow.sol) accepts
  one ERC-7984 confidential token (Zama's cUSDTMock on Sepolia) and keeps each escrow under its creator
  and a `todoRef`, meant to be a salted hash. It is deployed on Sepolia at
  [`0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code)
  and verified on Etherscan, Sourcify and Blockscout. A smoke test locked, decrypted and released a
  real amount there on 2026-09-16.
- **One passkey pays, on Sepolia.** Adding a delegated todo can lock a budget, the owner releases it
  once the delegate is done, the delegate is told about the payout, and an auditor view lists the
  escrows. Built with `VITE_BUDGET_SERVICE=zama` and an Openfort key, each passkey gets an account in
  the background that follows Calibur, a non-upgradeable wallet smart contract by Uniswap Labs, through
  EIP-7702; a lock or a release is one user operation the passkey signs,
  with gas sponsored by Openfort, and amounts are encrypted and decrypted in the browser. A run on
  2026-09-17 did all of it between two browsers ([passkey-account.md](passkey-account.md)).
  Amounts are read through a read key the account delegates decryption to; the browser keeps it only
  sealed, under a key the passkey derives, and "Show amounts" opens it once per visit.
- **Without that configuration, a fake.** It encrypts nothing and forgets its escrows on reload; the
  Account tab says "Demo without a chain". The tests run against it.
- **OrbitDB stores no amounts.** A todo's `budget` field holds status, token, escrow, `todoRef`,
  transaction hashes and the last error. The chain is the source of truth for what is locked.
- **The start dialog says what this is for, and has one button.** Its title names the use case —
  confidential escrow payments with a passkey — and its first screen holds the promise, **Sign in ·
  Sign · Pay** as one row with **Pay** set apart, three sentences about the data (amounts encrypted;
  todos and lists not; safest in a browser without extensions), and one button that says what it
  does: **Create a passkey and start**. Its press is the consent; the line under it says so. The other
  ways in are links under it: "Already have a passkey? Sign in with it" and "Look around without a
  passkey – no budget then". "Notices and settings" is a second screen in the same dialog: **Keep in
  this browser** (ticked; untick it on a shared computer), **Join a shared list** (the share-code
  field appears on request), the technical view, and all notices. Kept, a return with a passkey is
  one tap ("Welcome back"), and without one the app opens straight away; unticked, nothing is kept,
  not even the decision, so the dialog returns.
- **The start ends in a list of one's own.** Without a link the start points to a private list, "My
  todos", which the first todo creates (`openHomeList` in [`home-list.js`](../src/lib/home-list.js));
  a return finds it again. A link with three words (`#list=`) opens that shared list instead, where
  the form says that delegation needs a private list; a link with an address (`#db=`) opens that
  list.
- **Only the list on screen is offered to pass on.** The browser's three-word list stays open under
  one's own, so until the first todo makes "My todos" the address bar and the page QR carry no list,
  and the **Lists** tab copies nothing. It names the three words beside the open list, with **Open
  this list** (`openSharedList` in [`db-actions.js`](../src/lib/db-actions.js)): no restart, no
  passkey prompt, and from then on the words, the link and the QR code lead where one's todos go.
- **A light says how the other browser is connected.** Under the list name: white, no other browser;
  green, a direct WebRTC connection; yellow, only through the relay. It reads `connection.limits`,
  not the address ([`list-peers.js`](../src/lib/list-peers.js)).
- **A demo video.** A teaser left in the dialog's top row and a "Video" link in the header open one
  player over the page; it plays a file of this site, with a plain link to YouTube beside it. Each
  language has its own film; [`src/lib/demo-video.js`](../src/lib/demo-video.js) imports the files
  from `src/lib/demo-video/`, and a language without an entry shows neither.
- **The page opens on the todos.** Lists, account and network are tabs, at the foot of a phone's
  screen and under the header elsewhere. The URL fragment names the tab, so `#listen`, `#konto`,
  `#netzwerk` and the auditor view's `#pruefstelle` link straight to one.
