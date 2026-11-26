# What escrow01 builds on

`escrow01` is the last link in a chain of chapters: `collab01` → `passkey01` → `acl01` →
`privacy01` → `delegation01` → `escrow01`. Each section below introduced one link, and each
still holds here. They used to fill this chapter's README; they moved here as they were, with
corrections only where escrow01 does it differently. German: [foundations.de.md](foundations.de.md).

- [Per-todo delegation (from `delegation01`)](#-per-todo-delegation-from-delegation01)
- [Per-DID write permissions (from `acl01`)](#-per-did-write-permissions-from-acl01)
- [Passkey identities (from `passkey01`)](#-passkey-identities-from-passkey01)
- [Shared lists by three words (from `collab01`)](#shared-lists-by-three-words-from-collab01)

What escrow01 adds on top is in the [README](../README.md) and the [code tour](code-tour.md).

## 🤝 Per-Todo Delegation (from `delegation01`)

Built on `acl01`. A private list is still owner-only — but the owner can now
hand **one todo** to another DID. That delegate may complete or rename
exactly that todo, and nothing else, until the owner revokes it or the
delegation expires. This is the delegation half of
[de2do](https://github.com/NiKrause/de2do) (the escrow half, where the todo
is backed by funds in a smart contract, is `escrow01` itself), ported onto the
`acl01` foundation: sharing is still by address, permissions still live in
the panel, and the mnemonic list stays public.

- **A delegation is a field on the todo.** The owner writes
  `delegation: { delegateDid, grantedAt, expiresAt, revokedAt }` into the
  todo's own entry — on creation, or later from the row's **Delegate**
  button. Only the owner can, because only the write set may rewrite that
  entry. **Revoke** sets `revokedAt` the same way.
- **A delegate never rewrites the todo.** Their change goes in as a separate
  _delegation action_, keyed `delegation-action/<todoKey>/<delegateDid>/…`,
  signed by the delegate: either `set-completed` or `patch-fields`
  (`text`/`description`). Readers fold these into the todo they name
  (`src/lib/delegation.js`).
- **The access controller admits exactly those.** Private lists now open on
  [`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo),
  the same package de2do and `orbitdb-relay` use. It wraps the `acl01`
  controller — the write set, grant/revoke and the permissions panel are
  unchanged — and additionally lets an entry through when it is a
  well-formed delegation action whose _signer_ is the DID in its key.
  Anything else from a non-writer is refused, as before.
- **Revoke and expiry are decided on read, not in the controller.** The
  controller checks the action's shape and signature; it does not look the
  todo up. Whether the todo _currently_ delegates to that signer is decided
  by the reader: an action is ignored unless the todo's delegation names its
  signer, is not revoked, and has not expired. So revoking also takes back
  what the delegate already did, and a revoked delegate's later actions are
  accepted into the log but change nothing. This is a client-side rule — a
  peer running different code could keep applying them. Say so in your own
  app; de2do makes the same trade.
- **The owner's later write wins.** An action older than the todo's own
  `updatedAt` is dropped, so an owner can re-open a todo a delegate
  completed. (de2do re-applied every action forever; this is the one place
  the port departs from it.)
- **Every delegated write asks for the passkey again.** Ordinary writes
  never do: the identity's signing key sits in the keystore, unencrypted
  (see _Passkey Identities_ below). A delegate changing someone else's todo
  is the one thing this identity may do on a list it does not own, and it
  should not happen by accident. The header badge shows the prompt happen
  (`src/lib/delegated-write-auth.js`).

### The controller's type is not part of the address

The delegated controller reports `type: 'todo-delegation'`, but the address
it writes into the list's manifest is its wrapped base controller's,
`/orbitdb/<hash>`. OrbitDB picks the controller for a list opened **by
address** from that prefix — so a guest who opens a shared list by address,
which is how every list in this tutorial is shared, would get the plain
`orbitdb` controller, and a delegate's write would be refused on their own
machine before it was ever signed.

de2do sidesteps this by opening every list **by name** with the controller
passed explicitly, which works because its names are derivable
(`<ownerDid>_projects`). Here, lists are shared by address, so this chapter
takes the other route: the delegated controller is registered **as the
`orbitdb` type** (`src/lib/delegated-access.js`). Every `/orbitdb/…`
controller this build opens then checks the delegation rules, and the
manifest stays one that other builds and the relay can still open.

### ⚠️ What the relay makes of a delegate's entries

`orbitdb-relay` registers `todo-delegation` — but for the reason above it
never sees that type in a manifest, so it opens these lists with its built-in
`orbitdb` controller and **rejects delegation actions when it replicates**.
Alice and Bob exchange them directly (that is what the E2E test proves); the
relay pins the owner's entries only. If Alice is offline while Bob
completes, and they only ever meet through the relay, Bob's completion waits
until they are online together. A relay that accepts these entries needs a
controller whose _address_ carries its type — a change to the controller
package, and a good follow-up exercise.

### From `privacy01`, switched off

This chapter was copied from `privacy01`, and with it came that chapter's
per-entry sealing (`db-encryption.js`, `entry-encryption.js`,
`database-keys.js`). Nothing here imported it, so it has been removed;
`privacy01` and `invoice01` keep it. Lists here are as unencrypted as on
`acl01`. In `escrow01` only budget amounts are encrypted, on the chain.

The same goes for the signing key. `privacy01` later moved its passkey
identity to a key that lives in memory only; that change came after this
chapter was copied, so the identity here is still `acl01`'s. Its key follows
the storage choice: with **Keep in this browser** (preselected) it sits in
IndexedDB, unencrypted; unticked, in this tab's memory.

### Alice ↔ Bob ↔ Mallory walkthrough

1. Alice starts in a private list of her own, "My todos" (in `escrow01` the
   start is one; another comes from **Create private list** on the Lists
   tab). She adds a todo and ticks **Delegate this todo to another DID**,
   pasting Bob's DID (optionally with an expiry). She copies the list's
   `/orbitdb/…` address.
2. Bob and Mallory open that address. Both see the todo; both are refused
   when they try to add one. Bob's row is marked _delegate_ and its checkbox
   is enabled; Mallory's is not.
3. Bob ticks the todo. His passkey asks for confirmation, the header badge
   shows _Delegated write signed_, and Alice's row shows _completed_ with
   _Last changed by delegate_. Bob may also **Rename** it. Anything else on
   the list is still Alice's alone.
4. Alice clicks **Revoke**. Bob's completion disappears on both sides — the
   action still sits in the log, but no reader applies it — and his checkbox
   is disabled again. From the row she can **Re-delegate**, with or without
   an expiry.

## 🔑 Per-DID Write Permissions (from `acl01`)

Built on `passkey01`. Passkey identities become _meaningful_: you can grant
specific DIDs write access to a list of yours.

- **Public list stays public.** The mnemonic shared list from `collab01`
  keeps `write: ['*']` — open collaboration is unchanged.
- **Private lists are owner-only.** "Create private list" opens a new
  database on OrbitDB's mutable `OrbitDBAccessController` with
  `write: [your identity]`. Only you can write until you grant others.
- **Grant / revoke at runtime.** The permissions panel lists the write DIDs
  and lets the list admin add or remove them. The access controller is a
  replicated OrbitDB store, so grants propagate to peers **without changing
  the list's address**.
- **Sharing is by address.** A private list is shared via its full
  `/orbitdb/…` address (the "Open a shared list by address" form). Readers
  can replicate immediately; writing needs a grant.
- **Denied writes fail loudly.** A write from an unauthorized identity is
  rejected inside OrbitDB's `canAppend` gate _before_ anything is appended,
  so nothing ever looks saved — the UI shows a clear "no write permission,
  ask the owner to add your DID" message instead of crashing.

### Alice ↔ Bob walkthrough

1. Alice creates a private list `alice-todos` and adds a todo. She copies its
   `/orbitdb/…` address.
2. Bob opens that address, sees Alice's todo (read/replication works), but
   his own write is **denied** with a visible error.
3. Alice pastes Bob's DID into the permissions panel and grants write.
4. Bob writes again → success; both see both todos. The reverse (Bob owner,
   Alice guest) works identically.

### ⚠️ Relay / access-controller version compatibility

The chosen access-controller type must be known to the relay/pinner that
replicates the list. `orbitdb-relay` registers `orbitdb`,
`orbitdb-deferred` and `todo-delegation`; `acl01` used the built-in
`orbitdb` type, so no extra relay configuration was needed. `delegation01`
switches to
[`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo)
— see the chapter section above for what that does and does not change
about replication through the relay.

## 🔐 Passkey Identities (from `passkey01`)

The previous chapter (`collab01`) gave every browser a random throwaway
OrbitDB identity: entries were attributable to _a_ peer, but not to _you_.
This chapter replaces that with an opt-in **passkey-backed identity**:

- **Onboarding choice** before the P2P stack starts: _create a passkey_
  (the start button; its name is only a label, asked for in the technical
  view), _sign in with a passkey you have_ (recovery), or _look around without
  one_ (exactly the previous chapter's behaviour), as links under the button.
- **WebAuthn DID provider** from
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did):
  the DID is the passkey's own P-256 key, and OrbitDB signs entries with a
  **secp256k1 key derived from the passkey** (PRF → HKDF-SHA256; without PRF
  the keystore generates one instead). That key is **not encrypted**: with
  **Keep in this browser** it sits in OrbitDB's keystore in this browser's
  IndexedDB, where anyone who can read the browser's storage can read it
  (unticked, in this tab's memory). Creating a passkey costs three
  WebAuthn prompts (register, PRF, identity proof); after a reload a kept
  credential costs one (the identity proof), and a device that kept nothing
  costs three: two to restore, one to sign. On Sepolia, `escrow01` adds one
  more ([how often the passkey asks](passkey-account.md#how-often-the-passkey-asks)).
  Signing entries never asks. (The stricter _varsig_ variant — a passkey prompt for
  every single write — exists in the same package and is a good follow-up
  exercise, but is not used here.)
- **Create-or-recover flow** (`src/lib/passkey-identity.js`): the credential
  is written to `localStorage` only when the reader chose to keep things.
  Recovery uses that copy when it exists, and otherwise asks the authenticator
  itself: `restoreIdentityFromAuthenticator` (provider 0.8.0) derives the DID
  from two signatures and the signing key from the PRF output, so a device
  that has never seen this passkey — or a new one holding the same security
  key — comes back to the same identity and the same budget account, with
  nothing stored. There is no `largeBlob` layer any more; it never wrote
  anything ([provider #48](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/48)).
  This flow currently lives here — upstreaming it into the provider package
  is an open TODO.
- **Visible identity**: your DID appears in the header (in `escrow01`, in
  the Account tab; shortened, with a copy button), and every todo shows its author resolved from
  `entry.identity` — the field OrbitDB signs itself, so it cannot be faked
  by writing a different name into the todo payload.
- **Access control was unchanged** in `passkey01` (`write: ['*']`): that
  chapter was only about _who you are_, not yet about _who may write_.
  `acl01`, above, added that.

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

**Android without Google Play Services** (GrapheneOS): the PRF extension the
identity is derived from needs a credential provider that implements CTAP2
itself — which one does, how to set it up, and what the chapter does without
PRF is in [docs/grapheneos.md](../../../docs/grapheneos.md).

## Shared lists by three words (from `collab01`)

`collab01` extended the basic `main` tutorial with a three-word Spanish shared-list mnemonic, for example `luna-camino-verde`. The normalized mnemonic is the OrbitDB database name: two browsers enter the same words to open and replicate the same list without exchanging a full OrbitDB address. The mnemonic is only a convenient public share code—not a password, recovery phrase, encryption key, or access-control mechanism. Anyone who knows or guesses it can discover and edit the public writable list.

In `escrow01` that list is no longer where you start. Without a link the start ends in a private list of your own ("My todos"), because delegation and budgets exist only there. The browser's own three-word list is still opened in the background, and it is still the way to share a public list:

1. **Open two browser windows** — two browser instances, a mobile device, or another person far away.
2. **Load the same URL** in both.
3. **Put the shared list on screen in the first browser** — start (the start button; its press is the consent), open the **Lists** tab and press **Open this list** under **Share by three words**. Now the card above it names that list, with its three words and a **Copy** button, and the address bar and the page QR code carry it (`#list=…`). Before that the page offers no words to pass on: the start ends in "My todos", and the three-word list is open only underneath, where your todos do not go.
4. **Join it in the second** — open the link or scan the page QR code; or open **Settings** under the start button, tick **Join a shared list** and paste the words. Then press the start button.
5. **Wait for the connection** — the app discovers and connects the other peer.
6. **Add todos** in one browser and watch them appear in the other. On a shared list the form says that delegation needs a private list, and offers to create one.

## Try it yourself

### Delegation

You need three passkeys — three browsers, or three profiles of one:

1. In browser A (Alice), press **Create a passkey and start**. You are in your
   own private list, "My todos". Type a todo, tick **Delegate this todo to
   another DID** and paste browser B's **Passkey DID** (its Account tab).
   Add it — the first todo creates the list — then copy the `/orbitdb/…`
   address.
2. In browsers B (Bob) and C (Mallory), each with its own passkey, paste the
   address into **Open a shared list by address** (Lists tab). Both see the todo and
   both are refused when adding one. Only B's checkbox is enabled.
3. In B, tick the todo: the passkey prompt appears, the header shows
   _Delegated write signed_, and A's row updates. Click **Rename** on the
   row in B and watch the new name arrive in A and C.
4. In A, click **Revoke** on the row. The tick disappears in A and B, and
   B's checkbox is disabled. **Re-delegate** from the row to hand it back,
   this time with an expiry a minute ahead, and watch it turn _expired_.

`pnpm exec playwright test e2e/delegation.spec.js` runs this with three
virtual authenticators.

### Write permissions

The three-word list above stays public. To exercise access control, use a
**private list** and share it by address:

1. In browser A (owner), press **Create a passkey and start**, add a todo to
   "My todos" and copy the shown `/orbitdb/…` address. (**Create private
   list** on the Lists tab makes another one.)
2. In browser B (guest), create a _different_ passkey, paste the address into
   **Open a shared list by address** (Lists tab), and open it. You see the owner's todo,
   but adding one is **denied** with a visible error.
3. In browser A, copy browser B's **Passkey DID** (its Account tab) into the
   **Write permissions** panel (Lists tab) and click **Add DID**.
4. In browser B, add the todo again → it succeeds and both browsers converge.
   Owner and guest roles are symmetric — try it the other way around too.

See the full [Alice ↔ Bob walkthrough](#alice--bob-walkthrough) above for the
same flow described step by step.
