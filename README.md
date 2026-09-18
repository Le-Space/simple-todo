# simple-todo

A peer-to-peer todo list that runs entirely in the browser — OrbitDB over libp2p,
no server holding the data. The project is a tutorial: each chapter adds one idea
to the one before it, and each chapter is a complete app you can run.

| Chapter | What it adds | Live |
|---|---|---|
| `main` | The list itself, over libp2p and OrbitDB | [simple-todo.le-space.de](https://simple-todo.le-space.de) |
| `collab01` | A shared list behind three Spanish words | [collab01.le-space.de](https://collab01.le-space.de) |
| `qr01` | Two devices meet by scanning a QR code | [qr01.le-space.de](https://qr01.le-space.de) |
| `passkey01` | Your identity is a passkey, not a random key | [passkey01.le-space.de](https://passkey01.le-space.de) |
| `acl01` | Who may write is decided per DID | [acl01.le-space.de](https://acl01.le-space.de) |
| `privacy01` | Entries are sealed; holding the address is not reading it | [privacy01.le-space.de](https://privacy01.le-space.de) |
| `delegation01` | Hand one todo to another DID, and take it back | [delegation01.le-space.de](https://delegation01.le-space.de) |
| `escrow01` | Confidential budgets on Sepolia with Zama FHE | [escrow01.le-space.de](https://escrow01.le-space.de) |
| `invoice01` | Invoices on top of delegation | [invoice01.le-space.de](https://invoice01.le-space.de) |

## Layout

```
apps/<chapter>     one runnable app per chapter — only what that chapter teaches
packages/          what every chapter shares: net, ui, todo, e2e-kit, brand
tools/aleph        deploy and test-runner scripts, once instead of nine times
docs/              the tutorial, the testing notes, the frozen branch inventory
```

## Getting started

```
pnpm install
cd apps/delegation01
pnpm dev
```

Node 22 or newer, pnpm 9. `pnpm build` writes a static site; `pnpm test:unit`
runs the unit tests in a real Chromium; `pnpm exec playwright test` runs the
browser specs, which start their own relay and preview server.

## Where the chapters came from

Until September 2026 each chapter was a long-lived git branch in
[NiKrause/simple-todo](https://github.com/NiKrause/simple-todo), and every fix
had to be ported by hand into up to nine of them. Those branches are frozen;
their history is kept here under `refs/archive/<chapter>` and tagged
`frozen/<chapter>`. See [docs/FROZEN.md](docs/FROZEN.md) for the exact commits.

```
git fetch origin 'refs/archive/*:refs/archive/*'
git log refs/archive/qr01
```

## License

MIT
