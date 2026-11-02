# Sealed lists, and a second passkey

[Deutsch](./vault.de.md)

A list holds invoices and customer addresses, and OrbitDB has no read
permission: whoever has a list's address and reaches a peer that has it reads
everything in it, the relay included. **Seal it**, ticked when a list is made,
changes that for one list. Its entries are sealed before they leave the
browser, and what the relay and every other replica keep are bytes they
cannot read.

## Who reads a sealed list

The passkeys of these lists, and nobody else. That includes the people this
chapter is otherwise about: a DID granted write permission can still write,
but it cannot read what is there, and the delegate of a todo cannot see the
todo. That is why sealing is a choice and off unless ticked. A list for
invoices is sealed; a list shared with Bob is not.

Lists made before stay as they were. An entry written before a list was
sealed stays readable, because the decryptor passes it through
(`entry-encryption.js`). But a list is never sealed after it was made, so that
case only arises for lists sealed elsewhere.

What is sealed: every entry of the list, which means todos, invoices,
customers and settings alike. What is not sealed:

- the list's access controller, which says who may write;
- the entries' signatures and the identity that wrote each one;
- the registry of your lists, whose name nobody can derive from your DID
  (see `list-registry.js`).

## The vault

The key comes from the passkey, by way of a vault (`src/lib/list-vault.js`).
The vault holds one root, sealed under a random vault key. Each passkey of
these lists has a slot: the vault key, sealed under a key that only that
passkey derives from its PRF output. Any slot opens the vault, and the same
root comes out. The list key is derived from the root
(`simple-todo/invoice01/list-key/v1`), so every sealed list opens for every
passkey with a slot, and adding a list adds nothing to hand over.

It is Le-Space/belege's vault. The provider's `createVaultKeeper` (0.12.2)
keeps it, in Belege's format, under `simpleTodo.invoice01.vaults.v1` in this
origin's storage, beside the lists. The record is public JSON: labels,
credential ids and dates, with everything that matters sealed.

As in Belege, **the root is the PRF output of the passkey that made the
vault**, unchanged. That passkey therefore needs no vault to reach its own
lists. On a device that has never seen it, the first sealed list makes a new
vault with the same root, and every key comes out as it was. Its list
registry stays where it always was, under a name derived from its signature.

The vault also carries the address of that registry. A second passkey has
another identity and could never derive the name; the address in the vault is
how it finds the lists.

## A second passkey

Under _Lists → Passkeys of these lists_, the passkey you started with gives
another one a slot. That is the backup key in the drawer. It is made on the
spot and asked once. The browser goes on with the passkey it started with.
The panel shows the new passkey's DID, so it can be granted write permission
on the lists it should write to.

To use it, start with _Use an existing passkey_ and tick _Another passkey of
these lists_. The authenticator is then asked which passkey it holds, instead
of the one stored here. The second passkey:

- opens the vault through its own slot, and with it every sealed list;
- reads the first passkey's registry, so the lists switcher shows its lists;
- writes to a list once its DID is granted there, like any other DID;
- records no lists in that registry and forgets none: it belongs to the first
  passkey.

**Where it works:** in the browser where the vault is kept. invoice01 keeps no
copy of the vault anywhere else. Belege has an index on Aleph for that, and
this chapter has nothing like it. On another device the second passkey is an
identity of its own, with nothing in it. If this browser's storage goes as
well, the vault goes with it, and only the first passkey can make one again.
A second passkey is a key to this browser's lists, not a backup of them.

In memory mode, the vault lives only as long as the tab, so adding a passkey
is not offered.

## Taking a passkey out

The panel removes any passkey but the one in use. From then on it is refused
here: it starts as an identity of its own, without the lists, and is told so.

What removal cannot do is take back what that passkey has seen. It opened the
root, and the root is the first passkey's PRF output, which no renewal
changes. Whatever it read stays readable to any copy it kept. Belege can renew
its vault key; here that would not help, so it is not offered.

## Touches

Nothing here asks the passkey for anything until it is used. Every count below
is asserted in `e2e/list-vault.spec.js` or `e2e/passkey-restore.spec.js`.

| When                                                                                    | Touches                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Making a passkey                                                                        | 3, as before: the passkey, its PRF output, the identity    |
| Starting, no vault kept here for this passkey                                           | as before                                                  |
| Starting, a vault kept here for this passkey                                            | 1 more: the PRF output, and the vault opens                |
| The first sealed list, or the first second passkey, in the session the passkey was made | none: its PRF output was read at registration              |
| The same, in a later session without an open vault                                      | 1, on the passkey in use                                   |
| Adding a second passkey                                                                 | 2, on the new one: making it, and its PRF output           |
| Starting as the second passkey                                                          | 4: two to find it, one for the vault, one for the identity |

## Data format

These strings are part of the data. Changing one makes what exists unreadable:

- `simple-todo/invoice01/vault-slot/v1`: a passkey's slot key;
- `simple-todo/invoice01/list-key/v1`: the list key, from the root;
- `simpleTodo.invoice01.vaults.v1`: where the vault is kept.

An unreadable store is left as it is and never replaced, because it may hold
the only copy of a vault. Sealed lists then stay closed, and the start says
so.
