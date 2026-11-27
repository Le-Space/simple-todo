# Security of the confidential escrow

For security and cryptography reviewers of the `escrow01` chapter. It states what the escrow and the
sealed lists protect, what they leak, whom they trust, and what is not solved. Facts are as of
2026-09-16, those on the passkey wallet as of 2026-09-17, those on sealed lists as of 2026-11-27
(#176), and are sourced at the end; points that could not be verified say so. The mechanics are described in
[escrow.md](escrow.md) and [zama-confidential-transactions.md](zama-confidential-transactions.md);
the traced run is in [smoke-test.md](smoke-test.md).

Status: a testnet demonstration. `ConfidentialTodoEscrow` is deployed and verified on Sepolia and has
not been audited. Built with `VITE_BUDGET_SERVICE=zama`, the app locks, reads and releases budgets on
Sepolia from a passkey account, with gas sponsored by Openfort ([passkey-account.md](passkey-account.md));
without that setting its budget screens run against an in-memory fake that encrypts nothing.

- [Threat model](#threat-model-simple)
- [What leaks](#leaks-simple)
- [Trust assumptions](#trust-simple)
- [The token: cUSDTMock](#token-simple)
- [The auditor](#auditor-simple)
- [Input proofs and replay](#replay-simple)
- [Properties of the escrow itself](#escrow-properties-simple)
- [Limits](#limits-simple)
- [Passkey wallet](#passkey-wallet)
- [Sealed lists](#sealed-lists)
- [Open issues](#open-issues)

## Threat model

### Threat model: simple

The escrow is meant to keep one thing secret: how much money is locked and paid out. It is not meant
to hide who pays whom or when. It relies on Zama's key holders to keep the decryption key split and
on Zama's services to be available.

The app's lists are a second matter. Since #176 a private list is sealed: only the people it is
shared with read its todos, and the relay that keeps a copy does not. Who wrote to it, when, and who
holds which key stay visible. The shared list behind three Spanish words is not sealed: whoever
knows the words reads and writes it.

### Threat model: technical

Assets:

1. Confidentiality of amounts: locked amounts, the escrow's and the parties' token balances.
2. Integrity of funds: only the creator releases or refunds; a release pays the beneficiary the amount
   actually locked; nothing else moves a locked amount.
3. Availability: a creator can release or refund, and allowed parties can read amounts.
4. Metadata privacy: explicitly out of scope, see [What leaks](#leaks-technical).
5. Confidentiality of a sealed list: every field of a todo, the list's name, a delegate's rename. Its
   metadata is not protected ([What leaks](#leaks-technical), [Sealed lists](#sealed-lists-technical)).

Adversaries and what they can do:

| Adversary                                                  | Can                                                                                                                                         | Cannot                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chain observer                                             | read every transaction, calldata, event and storage slot on Sepolia, and the events of the Gateway chain                                    | decrypt a handle; tell a full lock from an underfunded one                                                    |
| Front-runner                                               | copy a pending `lock` (`todoRef`, handle, proof)                                                                                            | use the proof for another account or contract; occupy the creator's `todoRef` (escrows are keyed per creator) |
| Reader of an open list                                     | read everything in it: todo text; in a private list made before #176 also delegate DID and `budget` (`todoRef`, transaction hashes, status) | read amounts, which are not in OrbitDB                                                                        |
| Holder of a sealed list's address, the relay included      | read its metadata: entry keys, signers, the write list, who holds which key ([What leaks](#leaks-technical))                                | read a todo, the list's name or a delegate's rename; plant a key in the key store (#120)                      |
| Owner, writer, delegate or removed writer of a sealed list | see [Sealed lists](#sealed-lists-technical)                                                                                                 |                                                                                                               |
| Beneficiary                                                | read the locked amount and its own balance; check before starting work that the lock is not empty                                           | force a release                                                                                               |
| Creator                                                    | withhold a release and refund after the deadline                                                                                            | release to anyone but the recorded beneficiary; take funds before the deadline without releasing              |
| Auditor                                                    | read every amount ever locked in this escrow                                                                                                | move funds                                                                                                    |
| Token owner (Protocol DAO)                                 | upgrade cUSDTMock, add observers who can decrypt, block addresses, appoint a pauser                                                         | nothing is excluded by code; see [The token](#token-technical)                                                |
| Zama operators                                             | see section [Trust assumptions](#trust-technical)                                                                                           |                                                                                                               |
| Compromised browser or key                                 | read whatever that key may decrypt; sign as that account                                                                                    | read amounts it has no ACL permission for                                                                     |
| Holder of the page's Openfort key                          | have any Sepolia user operation sponsored under the project's rule                                                                          | sign for an account, move funds, read amounts                                                                 |

Creator, beneficiary and auditor can each also make a locked amount public through the token (see
[The token](#token-technical)).

## What leaks

### Leaks: simple

Everyone can see who locked money for whom, when, until when, which escrow reference was used and
when it was paid out. Everyone can see how much was converted between USDT and confidential USDT.
Nobody can see how much was locked or paid out. Zama's systems also record who asked to decrypt
which value, and when.

In the app's lists it depends on the list. The list behind three Spanish words is open: whoever
knows the words reads and writes all of it. A private list made since #176 is sealed: the relay and
anyone with its address get locked entries only, not the todos, not the list's name, not the escrow
reference. They still see who wrote to it and when, who may write to it, and who was given a key to
which todo. Private lists made before #176 stay open.

### Leaks: technical

Public on Sepolia (all confirmed in the transactions of the smoke run):

| Leak                                       | Where                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Sender (creator)                           | transaction `from`; `Locked` topic 1                                                                                             |
| Recipient (beneficiary)                    | `lock` calldata; `Locked` topic 3; ACL `Allowed` event; later `ConfidentialTransfer` topic 2                                     |
| Auditor address                            | `auditor()`; an ACL `Allowed` event in every lock                                                                                |
| Time                                       | block timestamps of `setOperator`, `lock`, `release`, `refund`                                                                   |
| Function                                   | method selector (Etherscan: "Lock", "Release")                                                                                   |
| `todoRef`                                  | calldata; topic 2 of `Locked`, `Released`, `Refunded`                                                                            |
| Deadline                                   | calldata; `Locked` data                                                                                                          |
| Operator window                            | `setOperator` calldata and `OperatorSet` event                                                                                   |
| Gas and fee                                | receipt                                                                                                                          |
| Handle identity                            | calldata, FHEVMExecutor events, `ConfidentialTransfer`, `Allowed`, `escrowOf`, `confidentialBalanceOf`                           |
| Computation graph                          | every FHE operation with its operand and result handles in FHEVMExecutor events                                                  |
| Input proof                                | calldata; `VerifyInput` event                                                                                                    |
| Amounts at wrap and unwrap                 | `wrap` calldata, ERC-20 `Transfer`, `TrivialEncrypt(pt)`, `Wrap(roundedAmount)`; `finalizeUnwrap` calldata and `UnwrapFinalized` |
| Number of escrows and releases per creator | count of `Locked` and `Released` events                                                                                          |

What handle identity reveals: equal handles denote equal values. A computed handle is a hash of public
data, and the executor events show which handles feed which operation. Reusing a handle, for example
locking the amount of an earlier escrow again with an empty proof, shows publicly that both
operations started from the same encrypted value. Trivial encryptions publish their clear value by
construction (`TrivialEncrypt(pt)`).

Correlation: a wrap of X shortly before a lock by the same address suggests a locked amount of at most
X. An unwrap by a beneficiary shortly after a release suggests the released amount.

Off Sepolia:

- **Gateway chain.** Each user decryption is a Gateway transaction by the relayer that emits
  `UserDecryptionRequest(decryptionId, ciphertext materials including the handles, userAddress,
publicKey, extraData)`, followed by one `UserDecryptionResponse` per KMS share. Who asked to read
  which handle, and when, is therefore public on the Gateway chain, for which Zama runs a public block
  explorer (`https://explorer.testnet.zama.org` for testnet); the shares themselves are encrypted to
  the requester's ML-KEM-512 key. Public decryption results are published there in clear.
- **Relayer.** Sees every request with addresses, handles and transport public keys, and the client's
  IP address.
- **OrbitDB, open lists.** The three-word list is open (`IPFSAccessController({ write: ['*'] })`):
  anyone with its words reads and writes every todo. It cannot delegate, so it never holds a budget.
  A private list made before #176 stays unsealed: anyone with its address reads todo text, delegate
  DID, `todoRef` and status, and can thus link a todo to its escrow on chain.
- **OrbitDB, sealed lists.** A private list made since #176 holds envelopes
  ([Sealed lists](#sealed-lists-technical)). Sealed are every field of a todo, `delegation` and
  `budget` (`todoRef`, transaction hashes, status) included, the list's name and a delegate's rename.

Not public: amounts inside the token (locked, released, refunded, balances), and whether a transfer
moved the requested amount or 0.

In a sealed list, the relay and anyone with the list's address read without a key:

| Readable                                                                 | Where                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry keys, and with them a todo's creation time                         | `key` of every entry (`todo_<milliseconds>_…`); `op` too, so a deletion shows                                                                                                                                            |
| Who wrote each entry, and in which order                                 | the entry's `identity` and its logical clock                                                                                                                                                                             |
| Which todos are handed to someone, and how often a key changed           | `scope` and `epoch` of each envelope                                                                                                                                                                                     |
| The size of each todo                                                    | the ciphertext; envelopes are not padded                                                                                                                                                                                 |
| A delegate's actions: which todo, by whom, when, done or not, until when | key `delegation-action/<todoKey>/<delegateDid>/…`; `taskKey`, `delegateDid`, `performedBy`, `performedAt`, `setCompleted`, `expiresAt`. Only `patch.text` is sealed: the access controller checks the rest without a key |
| Who may write                                                            | the access controller's write list (DIDs)                                                                                                                                                                                |
| Who holds a copy of which key, and so who was handed which todo          | slot names in the key store: `list/<epoch>/<did>`, `task/<todoKey>/<epoch>/<did>`                                                                                                                                        |
| The number of entries                                                    | the log                                                                                                                                                                                                                  |
| The signers' identity documents                                          | public by design: every entry names its signer's                                                                                                                                                                         |
| The list in its owner's registry: address, role, creation date           | the owner's list registry, which the relay holds and whose address only the owner can derive; the name there is sealed to the owner's own key                                                                            |
| Each identity's public key for sealed lists                              | the account directory, under the DID                                                                                                                                                                                     |

`todoRef` is SHA-256 over the todo's key and 32 random bytes (`createTodoRef` in
[`budget-service-zama.js`](../src/lib/budget/budget-service-zama.js)), so the readable entry key does
not lead to the escrow. The link can still be guessed: the key store names a delegate's DID beside
the todo's key, which carries its creation time; on Sepolia the account directory maps that DID to an
account; and `Locked` names creator and beneficiary, with its block time.

## Trust assumptions

### Trust: simple

The secrecy of amounts depends on Zama's key holders not colluding; Zama's whitepaper tolerates
collusion of up to 4 of the 13. Being able to read amounts at all depends on Zama's relayer, Gateway
and key holders being online. The rules of the whole system can be
changed by Zama's protocol governance.

Sealed lists add nobody to trust for secrecy beyond the people a list is shared with. The relay
keeps them without reading them: it is trusted to be there, not to keep a secret.

### Trust: technical

| Party                                                                 | Configuration on 2026-09-16                                                                                                                                                                                                                 | Trusted for                                                                          | Failure                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KMS operators                                                         | 13 signers; thresholds in ProtocolConfig: user decryption 9, public decryption 7, key generation 7, MPC 4 (Sepolia and mainnet). Zama's docs: nodes run by default in AWS Nitro Enclaves, protocol robust with at most one third malicious. | confidentiality of every ciphertext under the global key; correct decryption results | Zama's FHEVM whitepaper (June 2025) tolerates collusions of up to 4 of the 13 operators, so 5 or more colluding operators are outside that guarantee and could decrypt anything (see [zama-confidential-transactions.md](zama-confidential-transactions.md#trust-technical)); too few online operators stop all decryption |
| Coprocessors                                                          | input attestations: 3 of 5 signers on Sepolia, 1 of 1 on Ethereum mainnet                                                                                                                                                                   | accepting only well-formed inputs; correct FHE computation; storing ciphertexts      | per Zama's docs results are valid while more than half are honest; on mainnet a single signer key attests every encrypted input                                                                                                                                                                                            |
| Gateway                                                               | Arbitrum rollup, chain id 10901 (testnet)                                                                                                                                                                                                   | ordering and relaying requests, pinning the KMS context                              | halt: no input attestation, no decryption                                                                                                                                                                                                                                                                                  |
| Relayer                                                               | `relayer.testnet.zama.org`, no key; mainnet hosted relayer requires an API key; self-hosting is documented                                                                                                                                  | availability                                                                         | down: the SDK cannot encrypt or decrypt through it; on-chain state is unaffected                                                                                                                                                                                                                                           |
| Protocol DAO (owner of the ACL, and through it of all host contracts) | Sepolia `0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, mainnet `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`                                                                                                                                  | not changing the rules                                                               | can upgrade ACL, executor and verifiers, change coprocessor and KMS signer sets and thresholds, HCU limits and the deny list                                                                                                                                                                                               |
| PauserSet members                                                     | no function lists them; by the `AddPauser` events and `isPauser`: 1 on Sepolia, 17 on mainnet                                                                                                                                               | not pausing                                                                          | a paused ACL rejects `allow` and `allowTransient`, so every FHE operation reverts; only the owner unpauses                                                                                                                                                                                                                 |
| Client code                                                           | `@zama-fhe/sdk` 3.6.0, `@fhevm/sdk` 0.13.2, WASM from npm                                                                                                                                                                                   | honest key generation, proofs and reconstruction                                     | a compromised page reads decrypted values and the transport private key                                                                                                                                                                                                                                                    |

No service level agreement for the Sepolia relayer, Gateway or KMS is mentioned in the documentation
cited here. The incidents of 2026-08-31 to 2026-09-01 and of 2026-09-03 made user decryption fail on
Sepolia while the chain was correct (see
[zama-confidential-transactions.md](zama-confidential-transactions.md#incidents-technical)).

Sealed lists add no party to this table. What they rest on:

- **Who may hand out a key.** The key store's controller lets only the owner write
  (`IPFSAccessController({ write: [owner] })`), and OrbitDB refuses an entry her identity did not
  sign. The wrap itself authenticates no sender: its sender key is ephemeral.
- **Whose key a copy is wrapped for.** The public key in the reader's account directory, which only
  the reader's DID can write. Nobody can slip the owner a key of their own to wrap for.
- **Identity documents carried over gossipsub** ([`identity-blocks.js`](../src/lib/identity-blocks.js)).
  An answer to a newcomer carries its writers' identity documents. A session files each one only
  under the CID of its own bytes, computed on arrival, and OrbitDB verifies identity and entry as
  before. They add no trust: a bitswap fetch by that CID would have returned the same bytes. Identity
  documents are public.
- **The relay** holds envelopes, wrapped copies and metadata. It is trusted for availability only.
- **The page.** A page compromised while it runs reads every list this session holds a key for.

## The token: cUSDTMock

### Token: simple

The escrow holds Zama's test dollar token. Its owner, Zama's protocol governance, can replace the
token's code, name observers who may read all amounts in the token, block addresses and appoint
someone who may pause it. On 2026-09-16 there were no observers and nobody was appointed to pause it.

### Token: technical

cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491` is an ERC-1967 proxy to `ConfidentialWrapper`
`0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04` (exact match on Sourcify). Owner:
`0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, the Protocol DAO. Relevant powers in the verified source:

- **Upgrade.** UUPS; `_authorizeUpgrade` is `onlyOwner`. The escrow's funds depend on the
  implementation staying a correct ERC-7984. `renounceOwnership` is disabled.
- **Observers.** `addObserver(observer)` is `onlyOwner` and calls
  `FHE.delegateUserDecryptionWithoutExpiration(observer, WILDCARD_CONTRACT)`: the token delegates its
  own user-decryption rights to the observer for every contract, without expiry. The ACL grants a
  delegated decryption of a handle when the delegator (the token) and the named contract are both
  persistently allowed on it. The token keeps a persistent permission on every amount it returns, and
  the escrow allows itself on what it stores; on 2026-09-16 `persistAllowed(amount, cUSDTMock)` and
  `persistAllowed(amount, escrow)` were both true for the first locked amount. An observer can
  therefore decrypt every amount this escrow stores, as well as every balance and transfer in the
  token, which Zama's wrapper documentation states for balances, supply and transfers. Observers are
  public (`observers()`, `ObserverAdded` event); `observers()` returned an empty list on 2026-09-16.
- **Deny list.** `blockUser` is `onlyOwner`; the token's `_update` checks sender and recipient, and
  the caller when it is not the sender. The escrow is the caller or the sender in all three of its
  transfers, so blocking the escrow makes every `lock`, `release` and `refund` revert; a blocked
  creator makes `lock` and `refund` revert, a blocked beneficiary `release`, for as long as the block
  lasts. The owner can also make the token consult the underlying token's own deny list
  (`setUnderlyingDenyListSelector`); on cUSDTMock that check was off (`0x00000000`) on 2026-09-16.
  `isBlocked` was false for the escrow, the creator and the beneficiary during the run.
- **Pause.** `pause()` may be called only by `pauser()`, which the owner sets; `pauser()` returned
  `address(0)` on 2026-09-16, so nobody could pause without the owner appointing a pauser first. While
  paused, every transfer, and so every lock, release and refund, reverts.
- **Disclosure by a party.** `requestDiscloseEncryptedAmount(handle)` lets any account that is allowed
  on a handle make it publicly decryptable through the token, which is allowed too. The creator, the
  beneficiary and the auditor can each publish a locked amount this way; an observer cannot, because
  delegation is not an ACL permission.

## The auditor

### Auditor: simple

The escrow names one auditor forever. The auditor can read every amount ever locked in it. Today the
auditor is the developer's own test account, whose key the runbook keeps unencrypted in a
configuration file on a development machine.

### Auditor: technical

- `auditor` is `immutable`, set in the constructor, and non-zero. Every `lock` calls
  `FHE.allow(transferred, auditor)`. The ACL has no function that removes a persistent permission, so
  the auditor can decrypt every amount locked in this deployment for as long as the ciphertexts exist.
- Rotation is impossible. A new auditor means a new escrow. Escrows in the old contract stay there,
  and the old auditor keeps reading their amounts.
- The deployed auditor is `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, the deployer, which is also the
  creator of the smoke test. Its private key is the `DEPLOYER_PRIVATE_KEY` of the Sepolia runbook,
  which the runbook keeps in `contracts/.env`: a plaintext file that git ignores. Whoever obtains that
  key can decrypt every locked amount, lock and release as the smoke-test creator, and spend its
  Sepolia ETH.
- The auditor is visible to everyone: `auditor()` and the `Allowed` event in each lock.
- Delegated reading for an auditor service would use `ACL.delegateForUserDecryption`, which is itself
  public and links the auditor to its delegate.

## Input proofs and replay

### Replay: simple

An encrypted amount is only accepted from the person it was made for, through the contract it was made
for. Copying it out of a pending transaction does not help anyone else.

### Replay: technical

- The coprocessors sign `CiphertextVerification(bytes32[] ctHandles, address userAddress, address
contractAddress, uint256 contractChainId, bytes extraData)`. On chain, FHEVMExecutor sets
  `contractAddress` to its caller and takes `userAddress` from the calling contract, which is the
  escrow's `msg.sender`. InputVerifier recovers the signers with ECDSA and requires the threshold (3 of
  5 on Sepolia, 1 of 1 on mainnet). A proof used by another account or through another contract
  recovers a non-signer: `InvalidSigner`. The client-side ZK proof is additionally bound to contract,
  user, ACL and chain id through its metadata.
- Tests: "rejects an encrypted amount made for someone else" (another account replays the creator's
  input) and "verifies the encrypted amount itself instead of forwarding it to the token" (forwarding
  fails; encrypting for (token, escrow) instead produces a proof anyone can replay).
- There is no nonce. The same user can submit the same proof again through the same contract in a
  later transaction and gets the same handle: a second lock of the same encrypted amount. That is
  harmless for funds but links the two locks publicly.
- Within one transaction a verified proof is cached in transient storage under (contract, user,
  proof). Transient ACL permissions also last until the end of the transaction; in a bundle of
  user operations they survive from one operation to the next unless someone calls
  `cleanTransientStorage()`, which anyone may. They stay bound to the account they were granted to.
- With an empty proof the escrow accepts an existing handle only if `ACL.isAllowed(handle,
msg.sender)`; test "takes an existing handle without a proof only from someone who may use it".

## Properties of the escrow itself

### Escrow properties: simple

Only the person who locked the money can pay it out or take it back, and taking it back only works
after the deadline. Each escrow can be closed once. The escrow has no owner who could change these
rules.

### Escrow properties: technical

From the contract source and its 16 Hardhat tests in `contracts/test/ConfidentialTodoEscrow.ts`
(FHEVM mock):

- `release` and `refund` look up `_escrows[msg.sender][todoRef]`: creator-only by construction.
- `refund` requires `block.timestamp > deadline`; `lock` bounds the deadline to 365 days.
- One-shot: a second release, a release after a refund, a refund after a release and a second lock
  under the same `todoRef` all revert.
- State is written before the token is called (`lock`, `release`, `refund`).
- Events carry no amounts and no handles.
- Constructor rejects a token without ERC-7984 in ERC-165 and a zero auditor.
- No owner, no upgrade, no fee, no function besides `release` and `refund` that moves funds.

By design, not by oversight:

- The beneficiary has no on-chain claim. A creator can withhold a release and refund after the
  deadline; the escrow protects the creator's funds, not the beneficiary's work.
- An underfunded lock succeeds with an encrypted 0. The beneficiary should decrypt the locked amount
  before starting work; the app is meant to decrypt it after every lock.
- The operator approval (`setOperator`) has no amount, only an expiry. The escrow pulls only from its
  own caller, so nobody else can use the approval through the escrow, but it should expire soon.

## Limits

### Limits: simple

This runs on a test network with test money and test infrastructure, on a protocol version that is
about to be replaced. It is a demonstration, not a product.

### Limits: technical

- **Protocol v0.14.** Released 2026-08-14, not deployed on Sepolia or mainnet on 2026-09-16. It
  changes user decryption (unified permits, `durationSeconds`, ERC-1271 accounts) and host contract
  versions. The escrow is compiled with `@fhevm/solidity` 0.11.1 against v0.13 host contracts; a move
  to v0.14 needs a compatibility check and may need a new deployment, which would also mean a new
  auditor decision and new escrows ([redeploy checklist](../contracts/README.md#redeploy-checklist)).
- **Sepolia reliability.** Two decryption incidents in early September 2026. The smoke test retries
  relayer calls and waits two confirmations before decrypting; it cannot fix an outage.
- **No SLA** is documented for the testnet services in the sources cited.
- **Test assets.** USDTMock can be minted by anyone (up to 1,000,000 tokens per call). Nothing here has
  monetary value.
- **Mainnet differs.** Mainnet's InputVerifier has a single coprocessor signer; the hosted relayer needs
  an API key and bills fees; mainnet cUSDT is a different contract. Nothing in this chapter was run on
  mainnet.
- **Mock versus Sepolia.** The Hardhat mock uses host contracts 0.10.0: a delegation must expire at
  least one hour ahead and cannot use the wildcard, and HCU limits compare with `>=` where Sepolia's
  HCULimit uses `>`.
- **The app** has no refund button. Its Sepolia service maps a DID to an account through an OrbitDB
  directory only that DID can write, plus a check that the DID's passkey is an admin of the account
  ([Account lookup](passkey-account.md#account-lookup-technical)).

## Passkey wallet

Integrated on 2026-09-17 behind `VITE_BUDGET_SERVICE=zama`
([`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js),
[`src/lib/chain/`](../src/lib/chain)): Zama's token and the escrow, signed through an account on Calibur, a
non-upgradeable smart contract by Uniswap Labs ([What Calibur is](passkey-account.md#calibur-simple)),
that the passkey controls. How it works, step by step, is in [passkey-account.md](passkey-account.md). The
facts below concern Calibur v1.0.0 (Uniswap, tag `v1.0.0`), Zama v0.13 and what the app does with
them.

### Passkey wallet: simple

One passkey on the device controls the account that holds the money. Two properties of the chosen
account contract matter: the ordinary key that created the account stays an all-powerful master key
forever, and the chain does not check that the person actually confirmed with a fingerprint or face.
Reading amounts also needs an extra, temporary key in the browser, because Zama's current version
cannot accept signatures from such accounts; the app keeps it for up to 24 hours, stored only
sealed under a key the passkey derives. Nobody
can restore an account whose passkey is lost, and the key that pays for gas is readable in the page.
Before the passkey signs, the wallet code checks what the chain service asked for: no step may
cost more than a fixed limit, and the account's steps go one at a time.

### Passkey wallet: technical

- **The EOA setup key is root forever.** Calibur is an EIP-7702 delegation target. Its root key is the
  account's own secp256k1 key (`KeyLib.isRootKey`: a `Secp256k1` key whose address is the account
  itself; the placeholder key hash `bytes32(0)` stands for it). `register` and `update` refuse the root
  key, `revoke` cannot remove it because it is never in the key set, and `_isOwnerOrValidKey` always
  accepts it. `isValidSignature` accepts any raw 64- or 65-byte ECDSA signature from it. Calibur has no
  function to disable it. Independently of Calibur, under EIP-7702 that key can still send
  transactions and sign new delegation designations, so it keeps control of the account even when
  the delegation changes. Deleting the setup key after onboarding is the only protection, and it cannot
  be proven on chain. The app generates it in memory, uses it for one sponsored user operation, and
  drops every reference once the passkey is registered (`discard()`); the account holds nothing until
  the passkey signs its first lock.
- **User verification is not enforced on chain.** `KeyLib.verify` checks `WebAuthnP256` keys with
  `WebAuthn.verify({ ..., requireUV: false, ... })`. Whether the authenticator verified the user (PIN,
  biometrics) is enforced only by the client code that requests the assertion; the app requests
  `userVerification: 'required'`. The pinned webauthn-sol library requires the user-presence flag, and
  does not check the origin or the `rpIdHash` on chain.
- **Non-root keys sign ERC-1271 messages only in ERC-7739 form.** Calibur's `isValidSignature` routes
  raw signatures to the root key and expects the ERC-7739 TypedDataSign or NestedPersonalSign flow for
  every other key; the root key may use that flow too.
- **Zama v0.13 accepts only ECDSA permits.** `@fhevm/sdk` 0.13.2 requires 65-byte signatures and
  compares the recovered address; the Gateway's `Decryption` contract reverts with
  `InvalidUserSignature` unless the ECDSA signer is the user. A passkey account cannot sign a decryption
  permit. The app's workaround is a secp256k1 session key, the read key, that the account authorizes
  with `ACL.delegateForUserDecryption(sessionKey, contract, expiry)`, once per contract (token and
  escrow), for 24 hours: in the setup batch, and with a new key on every renewal. The key is stored
  sealed (AES-GCM under a key HKDF derives from the passkey's PRF output), in the browser's
  `localStorage` with "Keep in this browser" and in the tab's memory without it, and opened in memory
  once per visit; a page compromised while it is open can use it
  ([The read key](passkey-account.md#read-key-technical)). That PRF read is a touch of its own; the
  one PRF read of every start gives the OrbitDB signing key and the key for sealed lists
  ([Sealed lists](#sealed-lists-technical)). The `DelegatedForUserDecryption` event makes the link between
  account and session key public, and the session key can read everything the account may read in
  those contracts until the expiry or a revocation.
- **v0.14** adds ERC-1271 verification in the KMS connector for its new unified request (`ecrecover`
  for a 65-byte signature, otherwise a gas-capped `isValidSignature` call). On a Sepolia fork on
  2026-10-12, `@fhevm/sdk` 0.14.3's own ERC-1271 precheck accepted such a permit signed by the passkey
  account in ERC-7739 form ([keys.md](keys.md#checked-ahead-of-zama-on-2026-10-12)). Whether Zama's
  KMS accepts it stays open until v0.14 runs on Sepolia.
- **Sponsorship.** The publishable Openfort key is part of the page. The Openfort rule behind it,
  `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, accepts `sponsorEvmTransaction` on chain 11155111 with no
  restriction to contracts or functions. Anyone who reads the key out of the page can have arbitrary
  Sepolia user operations sponsored until the project's credits run out; the key cannot sign for any
  account. The app refuses a secret `sk_` key in its configuration (`readChainEndpoints`).
- **What the account refuses to sign (wallet 0.3.0).** Bundler, paymaster and RPC are Openfort's and
  public nodes', and up to wallet 0.2.0 the passkey signed whatever gas, fee and nonce key they chose
  (GHSA-fv6j-cmpw-5vf7). Since 0.3.0 each user operation is checked before a key is asked: on chain
  11155111 every gas field stays under a ceiling (preVerificationGas 250,000), gas limits ×
  `maxFeePerGas` stay under `MAX_USER_OPERATION_COST`, 0.02 ETH, and the nonce is on key 0. The setup,
  which the setup key signs, may carry up to 500,000 preVerificationGas: Openfort set 317,856 on the
  setups of 2026-11-25. On one nonce key an account's operations are sequential, so the app sends
  them one after the other (`oneAtATime` in [`sepolia-chain.js`](../src/lib/chain/sepolia-chain.js));
  sent while the first is pending, a second would take its nonce and replace it or be refused. A
  refusal reaches the page as "Nothing was signed and nothing was sent", and the passkey is not asked.
  The figures come from all 52 user operations escrow01 sent on Sepolia from 2026-09-17 to 2026-11-25
  ([`config.js`](../src/lib/chain/config.js)).
- **No recovery for a lost passkey.** Besides the discarded root key the passkey is the account's
  only key. A synced passkey reaches further devices and, since provider 0.8.0, gives back the
  identity and the account there with nothing stored, in four touches since #176 (three once
  provider #107 is released;
  [how often the passkey asks](passkey-account.md#how-often-the-passkey-asks)). A lost one takes the
  account with it, and every copy of a list key sealed for it.
- **Calibur v1.1.0.** Uniswap released v1.1.0 on 2026-07-02 at a new address and lists only that
  version since. Among other hardening it allows only admin keys to call the EntryPoint. The app uses
  v1.0.0, where its only non-root key is an admin
  ([What Calibur is](passkey-account.md#calibur-technical)).

## Sealed lists

Since #176 (issue #127) a private list is sealed in the browser before anything leaves it
([`src/lib/sealed/`](../src/lib/sealed)). The shared list behind three Spanish words, and private
lists made before #176, stay as they were. How the keys relate to the passkey is in
[keys.md](keys.md#keys-technical), how often the passkey asks in
[passkey-account.md](passkey-account.md#how-often-the-passkey-asks), and what stays readable in
[What leaks](#leaks-technical).

### Sealed lists: simple

Every todo in a private list is locked before it leaves the browser. The owner holds the key, and so
does everyone she lets write. Someone she hands a single todo to gets a key for that todo only. The
relay keeps the list without being able to read it, and so does anyone else who has its address.

Removing a writer gives everyone else new keys, and what is written after that is closed to the
removed writer. What they could read until then, they keep. The same holds for a delegate whose todo
was taken back.

The keys come from the passkey at every start and are never stored. A passkey without the PRF
extension gets a key that exists only in this browser: lists sealed for it open nowhere else, and
without "Keep in this browser" they close with the tab.

### Sealed lists: technical

Who reads what:

| Who                       | Reads                                                                                                                           | Does not read                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                     | every todo, the list's name, every delegate's rename                                                                            |                                                                                                                                                                                 |
| Writer                    | from the grant on, every epoch of every key the owner holds (`grant`): earlier todos too, delegated ones included, and the name | after removal, see the row below                                                                                                                                                |
| Delegate                  | the todo handed to them, as written from that delegation on, and their own renames                                              | the rest of the list; the name; what came before the delegation, since each delegation is a new epoch of the todo's key; the todo once taken back, which goes under `K_L` again |
| Removed writer            | what they could read until the removal                                                                                          | what is sealed under a later epoch of the list key or of a delegated todo's key (`keysAfterWriterLeft`)                                                                         |
| Stranger with the address | the metadata in [What leaks](#leaks-technical)                                                                                  | a todo, the name, a rename                                                                                                                                                      |
| Relay                     | the same as a stranger; it holds envelopes and wrapped copies                                                                   | the same as a stranger                                                                                                                                                          |

How it works:

- **Envelopes.** A todo's value becomes `{ sealed: 1, scope, epoch, nonce, ct }`: AES-GCM-256
  through WebCrypto with a fresh 12-byte nonce, and associated data that binds scope, epoch and entry
  key ([`sealed/envelope.js`](../src/lib/sealed/envelope.js)). A sealed todo therefore does not open
  under another entry key or scope. Sealing happens in the app, not in OrbitDB's `encryption.data`:
  `@orbitdb/core` 4.0.0 throws on a payload it cannot decrypt, and a reader who lacks one key would
  lose the history behind that entry. OrbitDB never sees a key. An envelope this session cannot open
  is hidden and counted; nothing throws.
- **Keys.** `K_L` is 32 random bytes per list and epoch, `K_T` the same per delegated todo and epoch
  ([`sealed/key-ring.js`](../src/lib/sealed/key-ring.js)). New entries go under the highest epoch a
  session holds. The keys live in the tab's memory only.
- **Copies.** Each copy of a key is wrapped for one reader: an ephemeral X25519 pair, ECDH with the
  reader's public key, HKDF-SHA-256 whose info names both public keys, AES-GCM-256 with the copy's
  slot as associated data ([`sealed/key-agreement.js`](../src/lib/sealed/key-agreement.js)). A copy
  moved to another slot or reader does not open.
- **The key store.** One `keyvalue` per list that only the owner writes
  ([`sealed/key-store.js`](../src/lib/sealed/key-store.js)), so nobody can plant a key (#120). Slots
  are `list/<epoch>/<did>` and `task/<todoKey>/<epoch>/<did>`. Its name follows from the list's
  address, so anyone with the address finds it. The owner wraps a copy for herself too. Only the
  owner delegates in a sealed list, because only she writes the store.
- **Epochs** ([`sealed/list-keys.js`](../src/lib/sealed/list-keys.js),
  [`sealed/list-session.js`](../src/lib/sealed/list-session.js)). A grant hands a writer every epoch
  of every key. Every delegation starts a new epoch of that todo's key, for the owner, the writers and
  the delegate. Taking a todo back starts no key: the todo goes back under `K_L`, which the delegate
  never had. Removing a writer starts a new epoch of the list key and of each delegated todo's key,
  for everyone but them.
- **Recognised by name.** A sealed list's database name is `sealed-v1-` and 32 random hex characters
  ([`sealed/sealed-list.js`](../src/lib/sealed/sealed-list.js)). Every peer knows a list is sealed
  before any entry arrives, so nobody writes a todo into it in the clear because a key is late. A
  session without a copy waits for one; it never makes a key of its own.
- **The list's name** is sealed under `K_L` in the key store (`meta/name`), not in the list. In the
  list registry a sealed list keeps `name` empty and carries the name sealed to the owner's own
  X25519 key, bound to the list's address
  ([`sealed/registry-names.js`](../src/lib/sealed/registry-names.js)). Addresses, roles and dates in
  the registry stay readable.
- **The personal key** is `deriveSubkey(prf, 'simple-todo/escrow01/list-key-agreement/v1')`:
  HKDF-SHA-256 over the passkey's PRF output, imported as an X25519 private key that cannot be
  exported. The same passkey gives the same key on every device. Its public half is in the account
  directory under the DID, which only that DID writes. That entry is published in every build, not
  only on Sepolia ([`chain/account-directory.js`](../src/lib/chain/account-directory.js)).
- **Without PRF**, and for an identity without a passkey, the key is random and generated
  non-extractable: kept in IndexedDB with "Keep in this browser", in the tab's memory without it
  ([`sealed/own-agreement-key.js`](../src/lib/sealed/own-agreement-key.js)). Lists sealed for it open
  in that browser only; without "Keep in this browser" they close with the tab.
- **Nothing the passkey can derive is stored.** Every passkey start reads PRF once
  ([`sealed/start-prf.js`](../src/lib/sealed/start-prf.js)). The OrbitDB signing key is derived from
  that output into a keystore in memory, in both storage modes ([keys.md](keys.md#keys-technical)),
  and the X25519 key from the same output, held for the tab. The output itself stays in the tab's
  memory, by credential, so that a restart in the same tab does not ask again. The unencrypted
  keystore an earlier build kept in IndexedDB is deleted at the next start, best effort
  ([`kept-signing-keys.js`](../src/lib/kept-signing-keys.js)).
- **Delivery.** The owner's browser answers every newcomer to a key store over gossipsub with the
  writers' identity documents and, for a small log, every entry; a session without a key asks again
  ([`newcomers.js`](../src/lib/newcomers.js)). This only delivers.
  [Trust assumptions](#trust-technical) says why it adds no trust.

Limits:

- A removed writer keeps what they could read until then: the log is append-only and is not
  re-encrypted. A session that has not yet received the new epoch seals under the highest one it
  holds, which the removed writer has. That the next list key does not reach them is unit-tested
  (`list-keys.spec.js`); the end-to-end check is `test.fixme`, for a delivery bug that predates #176.
- A delegate keeps the versions of their todo written while it was theirs.
- Two devices of one owner at once: see [Open issues](#open-issues), item 10.

Tests: `src/lib/sealed/*.spec.js`, and [`e2e/sealed-lists.spec.js`](../e2e/sealed-lists.spec.js)
with owner, delegate, writer and stranger, including that the stranger's copy of the log holds no
todo text in the clear.

## Open issues

1. Auditor: the deployed auditor is a development key in a plaintext file. Choose the real auditor
   and its key custody before relying on a deployment; a change requires a new escrow.
2. Token governance: observers, upgrade, deny list and pause of cUSDTMock lie with the Protocol DAO.
   Zama's wrapper documentation says wrapper ownership is to move to the underlying token's owner.
   On 2026-09-16 mainnet cUSDT `0xAe0207C757Aa2B4019Ad96edD0092ddc63EF0c50` was still owned by the
   Protocol DAO `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`, had no observers and no pauser, and
   consulted USDT's own blacklist (`getBlackListStatus`) as its underlying deny list.
3. Metadata: the three-word list is readable in full, and a private list made before #176 shows
   `todoRef`, delegate DID and budget status. A sealed list keeps those sealed, but its entry keys,
   signers, a delegate's action fields, the write list and the key store's slot names stay readable,
   and with them who was handed which todo ([What leaks](#leaks-technical)). Decryption requests are
   public on the Gateway chain.
4. The app has no refund button.
5. Passkey wallet: permanent root key, no on-chain user verification, public link between account and
   session key, an opened session key in the page's memory for the visit, no recovery for a lost passkey,
   Calibur v1.0.0 rather than v1.1.0.
6. Mainnet readiness: a single coprocessor signer for input attestation on mainnet, relayer API key
   and fees, v0.14 migration, no audit.
7. Decryption availability: the relayer's share settings after #3481 on Sepolia are unknown; there is
   no documented SLA.
8. No audit of the escrow; the tests run against a mock whose host contracts are older than Sepolia's.
9. Sponsorship: the Openfort rule sponsors any Sepolia user operation for whoever holds the page's
   publishable key; restrict it to the demo's contracts and cap it.
10. Sealed lists: two devices of one owner that hand out a todo or remove a writer at the same
    moment can each make a key for the same epoch. The key store keeps one copy per slot, a ring
    refuses a second key for an epoch it holds, and nothing resolves the conflict: what one device
    sealed may stay closed to readers who hold the other key.

## Sources

Repository (`apps/escrow01`, line numbers as of 2026-10-02):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): auditor
  49-52, constructor 71-78, `lock` 100-136 (allow to auditor 132), `release` 143-148, `refund` 150-158.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts): 16 tests,
  in particular 363-377, 379-419, 421-444.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt", "What stays public", "`.env`",
  "Before relying on a deployment".
- [`src/lib/budget/budget-service.js`](../src/lib/budget/budget-service.js) 1-18,
  [`src/lib/budget/budget.js`](../src/lib/budget/budget.js) 1-16, [`src/lib/i18n/en.json`](../src/lib/i18n/en.json)
  (`budget.notice.insufficient`).
- [`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js) (`ensureAccount`, `accountOf`,
  `renewReadKey`), [`src/lib/chain/sepolia-chain.js`](../src/lib/chain/sepolia-chain.js)
  (`createAccount`, `isPasskeyAccount`), [`src/lib/chain/config.js`](../src/lib/chain/config.js)
  (`readChainEndpoints`), [`src/lib/chain/account-store.js`](../src/lib/chain/account-store.js); the
  passkey wallet with its sources in [passkey-account.md](passkey-account.md#sources). Openfort rule
  `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, read through the Openfort CLI on 2026-09-17.
- Sealed lists, as of 2026-11-27 (#176, merge `83bb2e7`): [`src/lib/sealed/`](../src/lib/sealed)
  (`envelope.js`, `key-ring.js`, `key-agreement.js`, `key-store.js`, `list-keys.js`,
  `list-session.js`, `sealed-list.js`, `registry-names.js`, `own-agreement-key.js`, `start-prf.js`),
  [`src/lib/identity-blocks.js`](../src/lib/identity-blocks.js),
  [`src/lib/newcomers.js`](../src/lib/newcomers.js),
  [`src/lib/kept-signing-keys.js`](../src/lib/kept-signing-keys.js),
  [`src/lib/delegation.js`](../src/lib/delegation.js) (`buildDelegationAction`),
  [`src/lib/list-registry.js`](../src/lib/list-registry.js),
  [`src/lib/chain/account-directory.js`](../src/lib/chain/account-directory.js)
  (`publishAgreementKey`), `createTodoKey` in [`src/lib/db-actions.js`](../src/lib/db-actions.js),
  `createTodoRef` in [`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js).

cUSDTMock implementation on Sourcify
(<https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>):
`contracts/ConfidentialWrapper.sol` `WILDCARD_CONTRACT` 112, `blockUser` 229-231, `addObserver`
306-308, `observers` 336-338, `pauser` and `pause` 343-357, `renounceOwnership` 373-375,
`_addObserver` 391-403, `_requireNotBlocked` 420-425, `_update` 432-442, `_authorizeUpgrade` 497;
`contracts/token/ERC7984Upgradeable.sol` `requestDiscloseEncryptedAmount` 265-273, `_update` 343-378.

zama-ai/fhevm v0.13.5: `host-contracts/contracts/ACL.sol` (`allow` 206-216, `allowTransient` 253-272,
`delegateForUserDecryption` 283-334, `pause` 378-383, `isHandleDelegatedForUserDecryption` 478-491,
`cleanTransientStorage` 552-567, `_authorizeUpgrade` 591), `host-contracts/contracts/InputVerifier.sol`
(`verifyInput` 244-330, ECDSA-only recovery 517-525), `host-contracts/contracts/ACLEvents.sol`
(`DelegatedForUserDecryption`), `gateway-contracts/contracts/Decryption.sol` (`userDecryptionRequest`
441-526, `InvalidUserSignature` 916-927), `gateway-contracts/contracts/interfaces/IDecryption.sol`
(`UserDecryptionRequest` 96-102, `UserDecryptionResponse` 112-118),
`gateway-contracts/contracts/shared/Structs.sol` (`SnsCiphertextMaterial` 72-77). Pull requests
[#2393](https://github.com/zama-ai/fhevm/pull/2393) (ERC-1271 in the KMS connector) and
[#3481](https://github.com/zama-ai/fhevm/pull/3481).

`@fhevm/sdk` 0.13.2: `core/utils-p/runtime/recoverSigners.ts` 23,
`core/utils-p/decrypt/verifyKmsUserDecryptEip712V1.ts` 36-42, `core/modules/decrypt/module/api-p.ts`
236-242.

Calibur v1.0.0 (<https://github.com/Uniswap/calibur/tree/v1.0.0>): `src/libraries/KeyLib.sol` 26,
35-42, 58-77; `src/KeyManagement.sol` 21-46, 84-89; `src/Calibur.sol` 132-174. webauthn-sol at the
commit Calibur v1.0.0 pins (`619f20ab0f074fef41066ee4ab24849a913263b2`): `src/WebAuthn.sol` 77-88
(origin and `rpIdHash` not checked), 133 (user presence), 139 (user verification only on request).
EIP-7702: <https://eips.ethereum.org/EIPS/eip-7702>. Calibur v1.1.0: release of 2026-07-02 and
<https://github.com/Uniswap/calibur/compare/v1.0.0...v1.1.0> (`src/Calibur.sol`, `_process`).

Chain, read on 2026-09-16: cUSDTMock `owner()`, `observers()`, `pauser()`,
`getUnderlyingDenyListSelector()`, implementation slot; mainnet cUSDT `owner()`, `observers()`,
`pauser()`, `underlying()`, `getUnderlyingDenyListSelector()`; ACL `owner()`, `persistAllowed` on the
stored amount; InputVerifier, KMSVerifier and ProtocolConfig thresholds on Sepolia and mainnet;
PauserSet `AddPauser` events (Blockscout) and `isPauser` on Sepolia
(`0xc62392B4100a1bD45AbDBf91E70f1E4349402b46`) and mainnet
(`0xbBfE1680b4a63ED05f7F80CE330BED7C992A586C`).

Zama's FHEVM whitepaper, version 3.1 of 30 June 2025
(<https://github.com/zama-ai/fhevm/blob/main/fhevm-whitepaper.pdf>): KMS collusion bound, p. 12.

Zama documentation: confidential wrapper, observers
(<https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>); KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>); coprocessor
(<https://docs.zama.org/protocol/protocol/overview/coprocessor>); SDK security model
(<https://docs.zama.org/protocol/sdk/concepts/security-model>); relayer API keys
(<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>); Sepolia and Ethereum addresses
(<https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia>,
<https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum>); chains and Gateway
explorers (<https://docs.zama.org/protocol/protocol-apps/chains>).
