# Simple Todo - A Local-First Peer-to-Peer PWA Tutorial

[![Deploy](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml?query=branch%3Amain)
[![CI](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml?query=branch%3Amain)

A basic decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

> 📚 **This repository is a tutorial.** Its branches — `main`, `collab01`, `passkey01` — are chapters that build the app up step by step, so they are kept separate rather than merged into one another. This is the `archived01` chapter (the list's changes archived as sealed increments, built on `passkey01`).

## 🚀 Live Demo

- **This chapter (archived01)**: https://archived01.le-space.de
- **Previous chapter (passkey01)**: https://passkey01.le-space.de
- **Main app**: https://simple-todo.le-space.de
- **IPFS snapshot (Aleph gateway)**: https://ipfs.aleph.im/ipfs/bafybeigo5dip5jl5q6tzyp7xqtnzml25lbbw4y34kvkukgsa7au6qie37y/
- **IPFS snapshot (dweb.link)**: https://dweb.link/ipfs/bafybeigo5dip5jl5q6tzyp7xqtnzml25lbbw4y34kvkukgsa7au6qie37y/

The custom-domain link tracks the current deployment. The immutable CID links above are a snapshot
of the deployment published on July 11, 2026.

## 🗄️ This Chapter: Archived Increments (`archived01`)

The previous chapter made the writer of every todo a passkey. This chapter
makes the list survive the device: **every change goes out shortly after it
is written, as a sealed increment, to a store outside the browser** — nobody
clicks "back up", no other peer has to be online, and a wiped browser gets
the list back with the same passkey.

- **Increments, not full backups.** The storage bridge's
  [`live-backup`](https://github.com/NiKrause/orbitdb-storage-bridge/blob/main/docs/LIVE-BACKUP.md)
  watches the open OrbitDB database. Three seconds after a write (and at least
  every half minute while something is pending) it walks from the current
  heads back to what it last shipped and uploads what it passed as one small
  CAR: the new entries, the database's manifest and access controller, and the
  identity of every writer in it. Write-behind, never write-through: a local
  write never waits for the network, and a store that cannot be reached only
  makes the next increment larger. What survives a reload is a sequence number
  and a few hashes per database, in `localStorage`.
- **Two keys from one passkey, one touch.** The passkey's PRF output, read once
  at the start, yields through HKDF (`src/lib/archive/keys.js`)
  - the **archive account**: a secp256k1 key whose address is an ordinary
    Ethereum account. Aleph accepts STORE messages it signs (`personal_sign`)
    and books their cost to it, so credits on that address keep the increments.
    **No wallet extension, no MetaMask.** The key is never stored; it is derived
    again on every unlock and lives in memory until the tab closes.
  - the **backup key**: AES-GCM, sealing every increment before it leaves the
    browser. The store holds ciphertext.

  The same PRF output goes to the identity provider (`prfOutput`), so identity
  and archive cost one touch together. A second device with the same passkey
  derives the same account and the same key, lists the account's increments on
  Aleph by owner, and restores — with nothing stored beforehand.

- **Who pays, on Aleph — your choice.** By default the archive key is also the
  account holding the credits: nothing to set up, but the key lives in the tab,
  and whoever gets it (a bad dependency, an injected script) can spend the
  credits, forget the archive and probably move what is left. The panel's
  **Who pays?** offers the other way: an **owner account that never enters the
  browser** grants the archive key `STORE` on this chapter's channel, once,
  from where the owner's key lives — the panel reads the owner's public
  `security` aggregate, shows whether the grant is in place, and prints the
  complete `aleph` CLI command (0.20.0) for the owner, with every other grant
  the owner already has left as it was. The key then signs; Aleph checks the
  owner's grant and bills the owner (measured 2026-10-03). A leaked browser key
  can add storage on one channel and nothing else: it holds no credits and
  cannot forget — unless you tick _also ask for FORGET_, which lets you delete
  from the browser again at that price; otherwise the panel hands the owner the
  `aleph file delete` command. An info box lists both sides of both choices;
  `src/lib/archive/delegation.js` holds the pure parts, and
  `e2e/archive-owner.spec.js` runs the whole walk against a stand-in Aleph that
  checks signatures, ownership and grants the way the real one does.
- **Four stores, one contract.** Aleph Cloud (no account, no key; the archive
  key pays, or an owner account it was granted by), Pinata (a JWT, kept sealed with the backup key), Lighthouse
  (an API key; Filecoin deals; driver not yet verified live) and _this browser
  only_ for trying it out. Filecoin Onchain Cloud is designed but not yet a
  driver ([storage-bridge#151](https://github.com/NiKrause/orbitdb-storage-bridge/issues/151)).
- **Restore merges into the open list** (`joinIncrements`): what is here
  stays, what the archive holds is added, and the watcher is told that
  everything now present counts as shipped. Increments of other lists — the
  list's address changed when it became the passkey's, or an earlier device
  opened other words — are restored under their own addresses (the increments
  carry the manifest, so this works with the network off too) and their todos
  copied into the open list, written anew by this identity. A progress bar counts the
  increments as they download. In a fresh browser, **Restore from the
  archive** does the whole way from one button: unlock, find, join.
- **Every prompt says what it is for.** Creating a passkey touches the
  authenticator four times (register, largeBlob, PRF, identity proof);
  restoring one in a fresh browser three times (largeBlob read, PRF, proof),
  four with sealing or the archive on — the restore's PRF read serves the
  signing key and is not handed back ([provider#89](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/89));
  a later start in the same browser once, twice with sealing or the archive
  on. Before
  every touch after the first, a dialog says "prompt n of m" and what the
  touch is for (`src/lib/passkey-steps.js`, after Le-Space/belege#430), and
  starts it on _Continue_. The provider's own prompts cannot be announced from
  inside it yet
  ([provider#89](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/89)),
  so the page reads the PRF output itself on a first start and hands it to the
  provider — the same number of touches, and the archive is unlocked from the
  start.
- **A switch for the whole network.** The consent screen has _Peer-to-peer
  network: on / off_. Off, the chapter starts libp2p with no transports, no
  relay, no discovery and no pubsub, and opens the list without sync: nothing
  leaves the browser and nothing arrives from a peer. That is how to test a
  restore honestly — with the relay reachable, a wiped browser gets its list
  back by replication too — and the E2E test restores with the network off.
- **The list belongs to the passkey.** Its access controller names your DID
  as the only writer, and since the controller is part of the address, the
  same three words name a different list for every DID — and the same list for
  the same passkey on every device. Without a passkey the list stays the open
  one of the previous chapters.
- **Delete the archive.** Increments never go away by themselves and each
  costs by the hour. _Delete archive_ asks once, then forgets every increment
  the account keeps on the channel — on Aleph a FORGET signed by the archive
  key (for itself, or for the owner when the owner granted FORGET; otherwise
  the owner deletes from outside), elsewhere the service's own
  delete. The list stays; the watcher starts over, and the next increment
  carries the whole list again.
- **What the store learns.** Every increment is sealed, so the service holds
  ciphertext; it still sees the account's address, the channel, each blob's
  size and the moment it arrived (a few seconds after a write), and the
  balance reads name the address. The blob names carry a sequence number and
  nothing else. With the network off, the archive still talks to its store.
- **Another device's session is still you.** OrbitDB remembers a verified
  identity under its id signature and, on a hit, compares the whole identity;
  with a passkey the id signature is the same in every session while the
  WebAuthn proof is new per session, so after joining a laptop's archive the
  laptop's session sits in the cache and the phone's own writes are refused
  ("not allowed to write to the log", 2026-10-17). `packages/todo/src/stale-identity-cache.js`
  (from belege#259, upstream orbitdb/orbitdb#1258, shared by every passkey chapter) re-checks a refused webauthn
  identity the way an uncached one would be. The archive test restores as a
  new session on purpose and writes a todo afterwards; without the workaround
  that write is refused.
- **What a restore copies.** Todos of other archived lists are copied into the
  open list only when this identity may write to that list (its access
  controller names this DID or everyone), and only values shaped like a todo;
  a store that could forge a sealed blob still cannot put words into the
  owner's mouth. A chain with a missing increment is refused and named.
- **Seal the list — a box on the consent screen.** OrbitDB has no read
  permission: whoever holds an address and reaches a peer that has it reads
  everything in it, the relay that keeps it included. The `privacy01` chapter
  seals a list's entries and hands the key around in envelopes; this chapter
  needs no envelopes, because with a passkey the list is the passkey's — so the
  key comes from the passkey too, the same PRF output that yields the archive
  account and the backup key, through HKDF under a third info string
  (`src/lib/list-sealing.js`, the sealing itself ported from `privacy01`).
  Every device with the passkey derives the same key; the relay stores sealed
  entries; the archive's increments carry them sealed as well and a restore
  reads them back with the same passkey. It is a choice — _Seal the list_, on
  by default once a passkey is chosen — and the consent statement rewrites its
  sentence with it. Sealing is not part of the address: an existing list keeps
  the entries it already had in the clear and seals the ones that follow, and
  with the box unticked the passkey still opens what it sealed before (only
  `decrypt` is handed to OrbitDB) while new entries go out in the clear. A
  browser without the key keeps a sealed entry but finds no todo in it; the
  list then says how many entries it cannot read. Without a passkey there is
  no key, and the box says so. `e2e/sealed-list.spec.js` proves it on the log
  itself: every entry sealed on the way out, restored from the archive, and
  mixed once the box is unticked — a stranger's view is `privacy01`'s to
  prove, since nobody but the passkey can reach this list at all.
- **The consent statement follows every choice.** "What this means for your
  data" used to depend on the identity alone and said things that were no
  longer true (nothing stored on this device; the passkey stays on this
  device; nothing encrypted). It now rewrites itself with the network switch,
  the storage choice, the sealing box, the archive and its payer — and names
  the relay fairly: with the network on, our relay may keep (pin) the list so
  another device can collect it. The tick that releases the button sits inside
  that statement; a press on the waiting button opens it, scrolls to the tick
  and puts the cursor there, instead of swallowing the press as a disabled
  button did (`e2e/consent-screen.spec.js`).
- **Fits a phone.** The header's right-hand group (DID, language, theme, page
  QR, social links) wraps instead of pushing the page past the viewport;
  `e2e/phone-layout.spec.js` measures it at 360 px.
- **A Content Security Policy.** The page tells the browser where scripts may
  come from (its own origin and the one hashed inline script SvelteKit emits,
  nothing else), what it may connect to (TLS hosts and secure WebSockets only;
  plain `http:`/`ws:` only in a development build — relays and compute nodes
  are whatever the person picks, so no finite list of hosts describes them)
  and that it loads no plugins, frames or media. One known report per load:
  cbor-x, under the provider's WebAuthn parser, probes `new Function` once and
  takes its slow path when refused. Prerendered and served from IPFS, so the policy
  is a `<meta>` tag (`svelte.config.js`); the theme script moved out of
  `app.html` into `theme-init.js` for it. The point: a script that gets into
  this tab can ask the authenticator and walk off with the PRF output at the
  next touch, and the policy is the cheapest door to close. `e2e/csp.spec.js`
  listens for every violation while the app starts, syncs, writes, draws the
  QR code and switches theme and language, and expects none.
- **What it does not do.** Encrypt the list itself: anyone with the address can
  read it, and the relay still does. The seal is on the archive only.

### Try this chapter (archived increments)

1. Create a passkey and open the list, as in `passkey01`. Add a todo or two.
2. In **Archive**, pick a store. _This browser only_ needs nothing; for **Aleph**,
   click **Unlock archive** (one touch), copy the **archive account** and put
   credits on it at app.aleph.cloud (about 54 credits per MiB and day) — or,
   under **Who pays?**, name an owner account, run the printed `aleph` command
   where that account's key lives, and click **Check**.
3. **Switch archive on.** The first increment goes out within a few seconds;
   every todo after that makes another. **Check archive** lists them.
4. Wipe the site's data (or open a second browser with the same passkey —
   a security key with PRF, such as a YubiKey, carries it). After the passkey,
   the archive unlocks with the same touch; **Restore** brings the list back.

## 🔐 This Chapter: Passkey Identities (`passkey01`)

The previous chapter (`collab01`) gave every browser a random throwaway
OrbitDB identity: entries were attributable to _a_ peer, but not to _you_.
This chapter replaces that with an opt-in **passkey-backed identity**:

- **Onboarding choice** before the P2P stack starts: _create a passkey_
  (one name, and it is only a label), _use an existing passkey_ (recovery),
  or _continue without one_ (exactly the previous chapter's behaviour).
- **WebAuthn DID provider** from
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did):
  the DID is the passkey's own P-256 key, and OrbitDB signs entries with a
  **secp256k1 key derived from the passkey** (PRF → HKDF-SHA256; without PRF
  the keystore generates one instead). That key is **not encrypted**: it
  sits in OrbitDB's keystore in this browser's IndexedDB, where anyone who
  can read the browser's storage can read it. Creating a passkey costs four
  WebAuthn prompts (register, `largeBlob` write, PRF, identity proof); after
  a reload the only prompt is the `largeBlob` read of the recovery below, and
  signing never asks. (The stricter _varsig_ variant — a passkey prompt for
  every single write — exists in the same package and is a good follow-up
  exercise, but is not used here.)
- **Create-or-recover flow** (`src/lib/passkey-identity.js`): identity
  metadata is written to the authenticator's `largeBlob` when supported and
  always to `localStorage` as fallback; recovery tries `largeBlob` first.
  This flow currently lives here — upstreaming it into the provider package
  is an open TODO.
- **Visible identity**: your DID appears in the header (shortened, with a
  copy button), and every todo shows its author resolved from
  `entry.identity` — the field OrbitDB signs itself, so it cannot be faked
  by writing a different name into the todo payload.
- **Access control is unchanged** (`write: ['*']`): this chapter is only
  about _who you are_, not yet about _who may write_. That is the next
  chapter (`acl01`).

### The name you type is a label, not your identity

The onboarding form asks for one name, and nothing depends on it. A passkey
carries two human-readable fields (`user.name` and `displayName`) that exist
only so the browser's passkey picker has something to show. What identifies
the credential is the **user handle**, 64 random bytes the identity provider
generates — and your DID comes from the credential's public key, not from
either of them. Two people on the same device may type the same name and
still get two separate identities.

That is worth stating because it was not always true. While the handle was
derived from the typed name, an authenticator — which keeps one credential
per (origin, handle) — silently **replaced** the earlier passkey when a
second person used the same name, taking the DID and everything signed under
it with it
([provider #45](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/45)).
The WebAuthn spec says the handle must not contain personal data such as a
username or e-mail address, and should be random, for exactly this reason.

### ⚠️ Passkeys are bound to the origin (rpId)

A WebAuthn credential is scoped to the domain that created it. A passkey
registered on `http://localhost:5173` does **not** exist on
`https://simple-todo.le-space.de`, and a passkey created on one IPFS
gateway (`dweb.link`) is invisible on another (`ipfs.aleph.im`) — even for
the identical app build. For a local-first app distributed through many
gateways this is a real constraint: your DID is only portable across
devices via passkey sync (iCloud Keychain, Google Password Manager, …), not
across origins. Pin one canonical domain if stable identities matter.

## 🎯 What is this?

This is a **browser-only** local-first peer-to-peer todo application that operates without any traditional server infrastructure. It connects directly to other browsers and mobile devices through peer-to-peer connections, creating a truly decentralized experience. So far, a LibP2P signaling node is necessary to connect the peers, and in this version it also stores the todos since this browser version works with MemoryStorage only instead of local IPFSStorage (e.g. LevelBlockstore).

### Main Branch Scope

This branch extends the basic `main` tutorial with a three-word Spanish shared-list mnemonic, for example `luna-camino-verde`. The normalized mnemonic is the OrbitDB database name: two browsers enter the same words to open and replicate the same list without exchanging a full OrbitDB address. The mnemonic is only a convenient public share code—not a password, recovery phrase, encryption key, or access-control mechanism. Anyone who knows or guesses it can discover and edit the public writable list.

> **Collaboration examples:** [`collab01`](https://github.com/Le-Space/simple-todo/tree/main/apps/collab01) demonstrates mnemonic-based shared lists.

### Key Features

- ✅ **No Server Required** - PWA runs in browser, desktop or mobile.
- ✅ **Local Data** - Data is stored in your browser's level storage and replicated via OrbitDB and IPFS
- ✅ **Peer-to-Peer Communication** - Browsers connect directly via WebRTC (with help of libp2p signaling nodes)
- ✅ **Real-time Synchronization** - Changes appear instantly across all peers

## 🎯 How to Test

1. **Open Two Browser Windows** - You need at least two browser instances, a mobile device, or ask another distant person to open the app
2. **Load the Same URL** - All app users should load the same app URL
3. **Choose the Shared List** - Copy the three-word mnemonic from the first browser and paste it into the second
4. **Accept Consent and Open** - Check all consent boxes and select **Open shared list**
5. **Wait for Connection** - The app will automatically discover and connect peers
6. **Add Todos** - Create todos in one browser and watch them appear in the other

### Try the previous chapter (passkey identities)

1. On the onboarding screen pick **Create a passkey**, enter a name, then
   **Open shared list**. Your **Passkey DID** appears in the header (with a
   copy button).
2. Add a todo — it shows _Created by: your DID_. Have a second browser create
   its own passkey; each todo is attributed to the writer's DID on both sides.
3. **Reload** the page. The app preselects _Use an existing passkey_; confirm,
   and your DID is recovered unchanged (largeBlob, or localStorage fallback).
4. To compare, start once more with **Continue without a passkey** — you get
   the anonymous per-browser identity from the previous chapter.

## 📚 Documentation

For comprehensive guides on how this app works, implementation details, and reusable components:

**[📖 Tutorial](./docs/TUTORIAL.md)**

The tutorial covers:

- Step-by-Step implementation guide
- Architecture overview
- Testing procedures
- Troubleshooting guide
- Security considerations

**[🔧 Reusable Components](./docs/)**

- **[StorachaIntegration](./docs/StorachaIntegration.md)** - Complete Storacha/Web3.Storage integration component for backing up OrbitDB databases to decentralized storage

## 🛠️ Quick Start

```bash
# Clone repository
git clone https://github.com/Le-Space/simple-todo.git
# checkout main branch
git checkout main

# install dependencies and start the development server
pnpm install
pnpm dev
```

## 🛰️ Local Relay

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

## 🔧 Technologies Used

- **libp2p** - Peer-to-peer networking stack
- **IPFS** - Distributed file system (via Helia)
- **OrbitDB** - Decentralized database
- **Svelte** - Frontend framework
- **WebRTC** - Direct browser-to-browser communication

## ⚠️ Important Notes

- This is a **demo application** for educational purposes
- Data is stored in a **global unencrypted database** visible to all users
- **No privacy protection** - all data is publicly visible
- **Not suitable for production use** without additional security measures

## 📄 License

This project is open source and available under the [LICENSE](./LICENSE) file.

---
