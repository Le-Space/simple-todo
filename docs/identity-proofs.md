# Lists from before passkey provider 0.14.0

Since 2026-11-26 the eight chapters that make passkey identities (`passkey01`,
`acl01`, `privacy01`, `delegation01`, `escrow01`, `invoice01`, `archived01`,
`qr01`) refuse identity proofs in the first format
([#163](https://github.com/Le-Space/simple-todo/pull/163), advisory
[GHSA-7j39-c465-x35x](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/security/advisories/GHSA-7j39-c465-x35x)).
`main` and `collab01` use no passkeys and are not affected.

That choice was made knowing what it costs lists written before then, and
nothing moves them over. This page says what to expect
([Deutsch](identity-proofs.de.md)).

## In short

- **Your passkey stays yours.** The first start after the update asks for your
  passkey once more. You keep the same DID, so the same identity.
- **On the device that has the list, nothing changes.** You see your todos, add
  new ones, and remain the owner.
- **Anywhere else, an old list looks empty.** A second device, a browser in
  memory mode, or a browser whose site data was cleared shows none of the todos
  written before the update. In the chapters with write permissions, the DIDs
  you granted are missing too. You still own the list and can add new todos to
  it.
- **A fresh device does not find your old lists.** Where a chapter has "Your
  lists", it is kept the same way, so it comes up without them. In `escrow01` the first todo then starts a
  new list of your own.
- **Working together on an old list stops.** A device that has the list ignores
  new todos from others, because they build on the old ones, and a device
  without it sees nothing.
- **To use an old list elsewhere, start a new one.** Create a new list, add the
  todos again, and grant write access again. There is no automatic move.
- **An old tab sees nothing new.** A tab or a cached app still on the previous
  version shows nothing of a list once its newest todo was written after the
  update. Reload it.

### Why old proofs are not accepted for old entries

A first-format proof cannot be told apart from a forged one, and neither
carries a date anyone could trust. Accepting them for "old" entries would mean
accepting them everywhere, which is the hole the update closes.

## What happens, technically

- **The proof.** In the first format, the challenge the passkey signed was a
  bare 32-byte SHA-256 hash. Any signature the same passkey made over 32 bytes
  for something else could stand in for an identity of its DID, for good.
  Provider 0.14.0 signs
  `"orbitdb-webauthn-did:v2:<context>:" ‖ SHA-256(len(credentialId) ‖ credentialId ‖ data)`
  and requires user verification. Each chapter calls
  `configureWebAuthn({ acceptLegacyProofs: false })` at the top of
  `createOrbitDBInstance`, before OrbitDB learns the provider.
- **A returning device.** A stored first-format proof is refused and replaced:
  one more passkey prompt, once, a new identity document, the same DID. Every
  new entry is signed under the new document. In `escrow01` and `invoice01` the
  step dialog does not announce this prompt, because it is the first of its
  plan.
- **Why one old entry closes the list.** `@orbitdb/core` 4.0.0 (`log.js`,
  `joinEntry`) verifies every entry on the path from a new head back to what the
  device already has. One refused identity throws for the whole head, so none of
  it is added, including entries written after the update that build on old
  ones. Its filter for entries already present uses an asynchronous `has` and
  therefore filters nothing; that is why a device that has the list checks the
  old entries again when someone else's new entry arrives. The console then
  says `Could not append entry: Key "<old identity>" is not allowed to write to the log`.
  It says "not allowed" because the identity check sits in the access
  controller's `canAppend`.
- **Why the owner stays the owner.** `capabilities().admin` is the union of the
  access controller's entries and the write list in its manifest. The manifest
  is an unsigned IPFS block that no proof check touches, so the owner's DID is
  still found there. Grants are signed entries in the controller's own
  database and are refused like todos.
- **Why "Your lists" comes up empty.** The registry is an OrbitDB database whose
  entries were signed under the old identity document, so a device without a
  copy refuses them too.
- **Relays** keep the provider's default and still accept first-format proofs.
  The history they hold verifies there and is kept.
- **`escrow01`'s account directory** moved to a new database for the same
  reason; see
  [Account lookup: technical](../apps/escrow01/docs/passkey-account.md#account-lookup-technical).

## Measured

On 2026-11-26, on each chapter's E2E build: one origin serving three builds
(provider 0.13.0; 0.14.0 with the default; 0.14.0 refusing), a local relay on
0.14.0 with the default, and Chromium's virtual authenticators.

**Another device.** Alice made her passkey and list on 0.13.0, came back on the
refusing build and wrote again. Then fresh devices with passkeys of their own
joined her list.

| Chapter        | Prompts on Alice's return (default → refusing) | A fresh refusing device sees | Alice's device takes a newcomer's todo |
| -------------- | ---------------------------------------------- | ---------------------------- | -------------------------------------- |
| `passkey01`    | 0 → 1                                          | nothing                      | no                                     |
| `acl01`        | 0 → 1                                          | nothing                      | no                                     |
| `delegation01` | 0 → 1                                          | nothing                      | no                                     |
| `escrow01`     | 0 → 1                                          | nothing                      | no                                     |
| `invoice01`    | 0 → 1                                          | nothing                      | no                                     |
| `privacy01`    | 1 → 2                                          | nothing                      | no                                     |
| `qr01`         | 0 → 1                                          | nothing                      | no                                     |
| `archived01`   | 0 → 1 (1 → 2 with its default sealing)         | not measurable¹              | –                                      |

A fresh device on the default build saw all of Alice's todos within about two
seconds; one on 0.13.0 saw none of them, as a stale tab would.

¹ In `archived01` a list belongs to its DID, so another passkey never reaches
it. The only other reader is the owner's second device, and a virtual
authenticator loses the PRF secret when a credential is copied.

**The owner, without a local copy** (`escrow01`). The owner made her list on
0.13.0, wrote a todo and granted one DID write access. Then she came back with
nothing of it in the browser.

| Coming back                 | 0.13.0 or the default                            | Refusing                                               |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Memory mode, after a reload | owner; the todo and the grant are there          | owner, can write; the todo and the grant are missing   |
| Fresh device, same passkey  | the first todo opens her old list, with its todo | "Your lists" is empty; the first todo makes a new list |

`acl01`, `delegation01`, `invoice01`, `privacy01` and `qr01` keep their
registry and permissions the same way. The owner's side was measured in
`escrow01` only.
