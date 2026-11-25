# escrow01 · Vertrauliche Budgets für delegierte Aufgaben

[![Deploy](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/deploy.yml?query=branch%3Amain)
[![CI](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Le-Space/simple-todo/actions/workflows/ci.yml?query=branch%3Amain)

Eine Aufgaben-App, die im Browser läuft, ohne Server, der die Daten hält. Wer eine Aufgabe besitzt,
gibt sie an jemand anderen ab und sperrt dafür ein Budget; ist sie erledigt, wird das Geld
freigegeben. Der Betrag ist mit Zamas FHEVM verschlüsselt: Die Chain zeigt, wer für wen wann Geld
gesperrt hat, aber nie, wie viel. Ein Passkey meldet an, unterschreibt die Einträge der Liste und
bezahlt. [English](README.md)

Das ist das Kapitel `escrow01` des [Simple-Todo-Tutorials](../../README.md). Es baut auf
[`delegation01`](../delegation01) auf und ergänzt die Treuhand: einen Smart Contract, ein Konto pro
Passkey und einen vertraulichen Token, im Testnetz Sepolia.

## Ausprobieren

**Live:** [escrow01.le-space.de](https://escrow01.le-space.de/) (Deutsch) ·
[escrow01.le-space.de/en/](https://escrow01.le-space.de/en/) (Englisch). Testnetz Sepolia: Es fließt
kein echtes Geld.

1. **Passkey anlegen und starten** drücken. Der Start führt in eine eigene private Liste, „Meine
   Aufgaben“, die mit der ersten Aufgabe entsteht.
2. Eine Aufgabe eintragen, **An eine andere DID delegieren** anhaken, die **Passkey-DID** der anderen
   Person einfügen (ihr Tab **Konto**) und ein Budget eintragen.
3. Der anderen Person den Link der Liste schicken: Die Adresszeile trägt ihn, ebenso der QR-Code in
   der Kopfzeile. Sie hakt die Aufgabe als erledigt ab, und das Budget wird freigegeben. Der Tab **Konto** öffnet die
   Prüfansicht.

Ein Ablauf für Vorführungen, mit den Fragen, die Fachleute stellen, steht in
[docs/demo.de.md](docs/demo.de.md) ([English](docs/demo.md)).

## Was echt ist und was Vorführung

| Teil                | Heute                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beträge             | im Browser und auf der Chain verschlüsselt; lesen können sie, wer die Aufgabe besitzt, die delegierte Person und eine Prüfstelle                                                                                                                                                                        |
| Aufgaben und Listen | **nicht** verschlüsselt: Wer die Adresse einer Liste hat, kann sie lesen, auch der Relay. Eine private Liste beschränkt nur, wer _schreiben_ darf                                                                                                                                                       |
| Der Vertrag         | [`ConfidentialTodoEscrow`](contracts/src/ConfidentialTodoEscrow.sol) auf Sepolia unter [`0x6Ee3…3429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code), verifiziert auf Etherscan, Sourcify und Blockscout                                                        |
| Das Geld            | Zamas Test-Token cUSDTMock; die erste Sperre eines Kontos prägt ihm 1.000,00. Das Gas zahlt Openfort                                                                                                                                                                                                    |
| Die Prüfstelle      | eine im Vertrag festgelegte Adresse, die jeden Betrag lesen kann. Für eine Vorführung in Ordnung, für ein Produkt nicht ([Sicherheit](docs/security.de.md))                                                                                                                                             |
| Der Passkey         | DID, Signierschlüssel der Liste und Konto hängen an ihm. Ein erster Start fragt dreimal, auf Sepolia einmal mehr, um den Schlüssel zu versiegeln, der Beträge liest; ein Wiederkommen fragt einmal ([wie oft](docs/passkey-account.de.md#wie-oft-der-passkey-fragt), [vier Schlüssel](docs/keys.de.md)) |
| Ohne Sepolia        | ein Build ohne die Sepolia-Einstellungen nutzt eine Attrappe im Arbeitsspeicher: nichts wird verschlüsselt oder gesendet, ein Betrag ist nur in dem Tab lesbar, der ihn gesperrt hat, und der Tab **Konto** sagt „Demo ohne Chain“. Die Tests laufen gegen sie                                          |

Es ist eine Vorführung im Testnetz, gebaut zum Lernen und Zeigen. Für den Produktivbetrieb ist es
nicht bereit; was fehlt, steht unter den offenen Punkten in [docs/security.de.md](docs/security.de.md).

## Starten

```bash
git clone https://github.com/Le-Space/simple-todo.git
cd simple-todo
pnpm install
cd apps/escrow01
pnpm dev
```

- **Sepolia:** die Einstellungen aus [Konfiguration](docs/passkey-account.de.md#konfiguration) in
  `.env.local` eintragen und neu starten. Eine delegierte Person braucht ein Konto, bevor für sie ein
  Budget gesperrt werden kann; es wird nach ihrem ersten Start von selbst eingerichtet.
- **Ein Relay für `pnpm dev`:** [docs/TESTING.md](docs/TESTING.md#a-relay-for-pnpm-dev).
- **Tests:** `pnpm run test:unit`; welche Browser-Specs die CI fährt, steht in `chapter.json` →
  `ci.specs` ([docs/TESTING.md](docs/TESTING.md)).
- **Der Vertrag:** `cd contracts && npm ci && npm test` fährt 16 Tests im FHEVM-Mock-Modus;
  `npm run smoke:sepolia:dry` prüft die Bereitstellung auf Sepolia und braucht nur eine RPC-URL
  ([Runbook](contracts/README.md#sepolia-runbook)).

## Wo die Treuhand im Code liegt

| Schritt                                                            | Dateien                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Die Treuhand auf der Chain                                         | [`contracts/src/ConfidentialTodoEscrow.sol`](contracts/src/ConfidentialTodoEscrow.sol)                                                       |
| Die Zustände eines Budgets, als reine Funktionen                   | [`src/lib/budget.js`](src/lib/budget.js)                                                                                                     |
| Eine Schnittstelle für jede Budget-Operation, und ihre zwei Seiten | [`budget-service.js`](src/lib/budget-service.js), [`-fake.js`](src/lib/budget-service-fake.js), [`-zama.js`](src/lib/budget-service-zama.js) |
| Sperren und Freigeben, Schritt für Schritt                         | [`budget-flow.js`](src/lib/budget-flow.js), [`budget-store.js`](src/lib/budget-store.js)                                                     |
| Sepolia, Calibur, Zamas SDK                                        | [`src/lib/chain/`](src/lib/chain)                                                                                                            |
| Der Start: ein Passkey, eine eigene private Liste                  | [`src/routes/+page.svelte`](src/routes/+page.svelte), `openHomeList` in [`db-actions.js`](src/lib/db-actions.js)                             |

In welcher Reihenfolge man sie liest, zeigt der [Rundgang durch den Code](docs/code-tour.de.md); er
verfolgt auch eine Sperre vom Formular bis zur Chain.

## Worauf es aufbaut

Delegation einzelner Aufgaben aus `delegation01`, Schreibrechte pro DID aus `acl01`,
Passkey-Identitäten aus `passkey01` und geteilte Listen über drei Wörter aus `collab01`: jeweils mit
Durchgang in [docs/foundations.de.md](docs/foundations.de.md). Darunter: libp2p, Helia, OrbitDB und
Svelte, alles im Browser.

## Mehr lesen

- [docs/code-tour.de.md](docs/code-tour.de.md): der Code in Lesereihenfolge, und eine Sperre von
  Anfang bis Ende
- [docs/escrow.de.md](docs/escrow.de.md): Rollen, Ablauf, `todoRef`, was öffentlich ist und was
  verschlüsselt
- [docs/passkey-account.de.md](docs/passkey-account.de.md): das Konto des Passkeys (Calibur),
  Gas-Sponsoring, wo Beträge ver- und entschlüsselt werden und wie oft der Passkey fragt, mit
  Sequenzdiagrammen
- [docs/keys.de.md](docs/keys.de.md): die vier Schlüssel hinter einem Passkey, warum es den
  Leseschlüssel gibt, was Zama v0.14 daran ändert und wie es weitergeht
- [docs/zama-confidential-transactions.de.md](docs/zama-confidential-transactions.de.md): Zamas
  Protokoll, wie es hier verwendet wird, von Handles bis zur Schwellenwert-Entschlüsselung
- [docs/money-flow.de.md](docs/money-flow.de.md): woher das Testgeld kommt, wem die Token-Verträge
  gehören und was an einer Sperre und einer Freigabe öffentlich ist
- [docs/smoke-test.de.md](docs/smoke-test.de.md): der Lauf auf Sepolia vom 2026-09-16, Schritt für
  Schritt
- [docs/security.de.md](docs/security.de.md): Bedrohungsmodell, Lecks, Vertrauensannahmen, offene
  Punkte
- [docs/demo.de.md](docs/demo.de.md): der Ablauf für Vorführungen
- [docs/foundations.de.md](docs/foundations.de.md): was das Kapitel von den vorigen erbt
- [docs/TESTING.md](docs/TESTING.md) (Englisch): Unit-, Browser- und Vertragstests, und ein Relay
  für die Entwicklung
- [contracts/README.md](contracts/README.md) (Englisch): Werkzeuge, Bereitstellung, Verifikation,
  Smoke-Test
- [e2e-video/README.md](e2e-video/README.md) (Englisch): wie der Demo-Film aufgenommen wird

## Lizenz

Dieses Projekt ist Open Source und steht unter der [LICENSE](./LICENSE).
