# GrapheneOS / Android without Google Play Services

The passkey chapters (`passkey01` and everything built on it: `acl01`,
`privacy01`, `delegation01`, `escrow01`, `invoice01`, `archived01`) derive key
material from the passkey through the WebAuthn **PRF extension** — on a
hardware key, CTAP2's `hmac-secret`. On
stock Android that extension is answered by Google Play Services. On
GrapheneOS, or any Android without Play Services, the system can only talk
U2F to a security key over NFC: no CTAP2, so no PRF. A **credential provider
app** that implements CTAP2 itself closes that gap. This page says which one
does, how to set it up, and what simple-todo does when PRF is missing.

Tested with a YubiKey over NFC and USB in Vanadium and in Chrome on
GrapheneOS, 2026-10.

## Compatibility

| Credential provider                                                                                           | Browser          | Passkey login                | PRF | Tested with                                        |
| ------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------- | --- | -------------------------------------------------- |
| [Authnkey](https://f-droid.org/packages/pl.lebihan.authnkey/) (`pl.lebihan.authnkey`)                         | Vanadium         | ✅                           | ✅  | Authnkey `TODO: Version`, Vanadium `TODO: Version` |
| Authnkey                                                                                                      | Chrome           | ✅                           | ✅  | Authnkey `TODO: Version`, Chrome `TODO: Version`   |
| [Passchain](https://codeberg.org/s1m/hw-fido2-provider) (formerly "HW FIDO2 Provider", `s1m.hwfido2provider`) | Vanadium, Chrome | ✅                           | ❌  | Passchain `TODO: Version`                          |
| none                                                                                                          | Vanadium, Chrome | U2F only — no CTAP2 over NFC | ❌  | GrapheneOS `TODO: Version`                         |

- **Authnkey** (MIT, Android 14 and newer) implements CTAP2 over NFC and USB
  on its own and needs no Play Services. It answers PRF requests; PRF support
  arrived with version 1.2.0.
- **Passchain** works for an ordinary passkey login but hands out **no PRF**.
  It embeds the FIDO2 implementation of [microG](https://microg.org/), and
  microG has not implemented `hmac-secret` yet — the open feature request is
  [microg/GmsCore#1815](https://github.com/microg/GmsCore/issues/1815).
- **Without a provider** Android reaches the key over NFC with U2F only, so
  there is no CTAP2 and no PRF.

## Setup with Authnkey

1. Install **Authnkey** from F-Droid
   ([f-droid.org/packages/pl.lebihan.authnkey](https://f-droid.org/packages/pl.lebihan.authnkey/);
   source: [github.com/mimi89999/Authnkey](https://github.com/mimi89999/Authnkey)).
2. Open **Settings › Passwords, passkeys & accounts** and switch Authnkey on
   as the preferred service for passkeys.
3. Open the app in Vanadium or Chrome and **register the passkey anew**
   ("create a passkey" in the onboarding dialog). A passkey that was created
   earlier through Passchain, or with no provider at all, has no
   `hmac-secret` and cannot be upgraded; see Troubleshooting below.

## Passchain: login yes, PRF no

> **Note.** With Passchain the passkey registers and logs in, but the PRF
> request comes back unanswered. That is not a Passchain bug of its own: it
> uses microG's FIDO2 code, and microG does not implement `hmac-secret`
> ([microg/GmsCore#1815](https://github.com/microg/GmsCore/issues/1815), open).
> Nothing on this page says when that will change.

What simple-todo does when the credential has no PRF — read from the code,
not from the spec:

- **The identity still works.** The provider derives the OrbitDB signing key
  from the PRF output; without it, OrbitDB's keystore generates a random
  signing key instead. The DID stays the same (it is the passkey's own P-256
  key), so entries are still attributed to you and per-DID write permissions
  (`acl01`) still apply. Nothing fails, and the app shows one warning toast per
  credential (`consent.prfMissing`):

  > This authenticator cannot carry your identity to a second device (no
  > PRF). The same passkey produces a separate identity there.

  On Android the toast adds the hint that a credential provider with PRF
  fixes this and points here.

- **The identity does not travel.** The signing key is what PRF makes
  reproducible. Without PRF each device signs with a key of its own: two
  identity documents under one DID. Recovery on a second device gives you the
  DID, not the signing key. In `privacy01`, whose keys live only for the
  session, every session gets a new one; its toast says so.
- **`archived01` refuses to archive.** The archive account and its keys are
  derived from the PRF output and nothing else; without it the archive panel
  reports "This authenticator gives no PRF output; no account and no key could
  be derived from it."
- **`escrow01` cannot seal.** The sealing key comes from the PRF output; a
  passkey without PRF gets a read key that holds for the session only
  (`passkey-without-prf`).
- **`privacy01` and `invoice01` are unaffected beyond the identity.** Their
  sealing key is a random key per database in this browser's storage, not
  derived from the passkey.

## Troubleshooting

- **Does this passkey have PRF?** PRF has to be requested when the credential
  is created. After `navigator.credentials.create()` the answer is in
  `credential.getClientExtensionResults().prf?.enabled`; `true` means the
  authenticator and the provider support it for this credential. The provider
  records the same answer, and the chapters read it from the credential's
  `extensionSupport.prf` — that is what triggers the toast.
- **A passkey without PRF cannot be upgraded.** `hmac-secret` is a property of
  the credential, set at registration. A passkey created through Passchain,
  or before a provider was installed, stays without PRF; create a new one
  after switching to Authnkey.
- **Switching providers means re-registering.** The credential belongs to the
  provider that created it. After changing the preferred passkey service,
  register the passkey anew in the app.
- **The toast appears although Authnkey is active.** Check that Authnkey is
  the _preferred_ service under Settings › Passwords, passkeys & accounts,
  that the passkey being used was created after that, and that it was created
  on this origin — passkeys are bound to the domain that created them (see the
  rpId note in the chapter READMEs).

## Links

- Authnkey on F-Droid: <https://f-droid.org/packages/pl.lebihan.authnkey/>
  — source: <https://github.com/mimi89999/Authnkey> (MIT)
- Passchain, formerly HW FIDO2 Provider: <https://codeberg.org/s1m/hw-fido2-provider>
- microG `hmac-secret` feature request: <https://github.com/microg/GmsCore/issues/1815>
  (open; the older, closed FIDO2 thread is
  [#849](https://github.com/microg/GmsCore/issues/849))
- The identity provider the chapters use:
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did)
