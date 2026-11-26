# Listen aus der Zeit vor Passkey-Provider 0.14.0

Seit dem 26.11.2026 lehnen die acht Kapitel, die Passkey-Identitäten anlegen
(`passkey01`, `acl01`, `privacy01`, `delegation01`, `escrow01`, `invoice01`,
`archived01`, `qr01`), Identitätsnachweise im ersten Format ab
([#163](https://github.com/Le-Space/simple-todo/pull/163), Advisory
[GHSA-7j39-c465-x35x](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/security/advisories/GHSA-7j39-c465-x35x)).
`main` und `collab01` nutzen keine Passkeys und sind nicht betroffen.

Das wurde in Kenntnis dessen entschieden, was es Listen kostet, die vorher
geschrieben wurden, und nichts zieht sie um. Diese Seite sagt, womit zu rechnen
ist ([English](identity-proofs.md)).

## Kurz gesagt

- **Ihr Passkey bleibt Ihrer.** Der erste Start nach dem Update fragt den
  Passkey noch einmal ab. Sie behalten dieselbe DID, also dieselbe Identität.
- **Auf dem Gerät, das die Liste hat, ändert sich nichts.** Sie sehen Ihre
  Aufgaben, legen neue an und bleiben Besitzerin oder Besitzer.
- **Überall sonst wirkt eine alte Liste leer.** Ein zweites Gerät, ein Browser
  im Arbeitsspeicher-Modus oder ein Browser mit gelöschten Websitedaten zeigt
  keine der Aufgaben, die vor dem Update geschrieben wurden. In den Kapiteln mit
  Schreibrechten fehlen auch die DIDs, denen Sie Schreibrecht gegeben haben. Die
  Liste gehört weiter Ihnen, und Sie können neue Aufgaben hinzufügen.
- **Ein frisches Gerät findet Ihre alten Listen nicht.** Wo ein Kapitel „Ihre
  Listen“ hat, wird diese Übersicht genauso geführt und erscheint ohne sie. In
  `escrow01` legt die erste Aufgabe dann eine neue eigene Liste an.
- **Zusammenarbeit an einer alten Liste endet.** Ein Gerät, das die Liste hat,
  übergeht neue Aufgaben anderer, weil sie auf den alten aufbauen, und ein Gerät
  ohne sie sieht nichts.
- **Um eine alte Liste anderswo zu nutzen, legen Sie eine neue an.** Neue Liste
  anlegen, Aufgaben neu eintragen, Schreibrechte neu vergeben. Einen
  automatischen Umzug gibt es nicht.
- **Ein alter Tab sieht nichts Neues.** Ein Tab oder eine zwischengespeicherte
  App auf dem alten Stand zeigt von einer Liste nichts mehr, sobald ihre neueste
  Aufgabe nach dem Update geschrieben wurde. Neu laden hilft.

### Warum alte Nachweise nicht für alte Einträge gelten

Ein Nachweis im ersten Format lässt sich von einem gefälschten nicht
unterscheiden, und keiner von beiden trägt ein Datum, dem man trauen könnte.
Sie für „alte“ Einträge anzunehmen hieße, sie überall anzunehmen, und genau
diese Lücke schließt das Update.

## Was technisch passiert

- **Der Nachweis.** Im ersten Format war die Challenge, die der Passkey
  signierte, ein bloßer SHA-256-Hash von 32 Byte. Jede Signatur, die derselbe
  Passkey für etwas anderes über 32 Byte gemacht hat, konnte dauerhaft als
  Identität seiner DID gelten. Provider 0.14.0 signiert
  `"orbitdb-webauthn-did:v2:<context>:" ‖ SHA-256(len(credentialId) ‖ credentialId ‖ data)`
  und verlangt User Verification. Jedes Kapitel ruft
  `configureWebAuthn({ acceptLegacyProofs: false })` am Anfang von
  `createOrbitDBInstance` auf, bevor OrbitDB den Provider kennt.
- **Ein zurückkehrendes Gerät.** Ein gespeicherter Nachweis im ersten Format
  wird abgelehnt und ersetzt: einmal eine Passkey-Abfrage mehr, ein neues
  Identitätsdokument, dieselbe DID. Jeder neue Eintrag wird unter dem neuen
  Dokument signiert. In `escrow01` und `invoice01` kündigt der Schritt-Dialog
  diese Abfrage nicht an, weil sie die erste ihres Plans ist.
- **Warum ein alter Eintrag die Liste schließt.** `@orbitdb/core` 4.0.0
  (`log.js`, `joinEntry`) prüft jeden Eintrag auf dem Weg von einem neuen Head
  zurück bis zu dem, was das Gerät schon hat. Eine abgelehnte Identität wirft
  für den ganzen Head, also kommt nichts davon dazu, auch keine Einträge nach dem
  Update, die auf alten aufbauen. Der Filter für schon vorhandene Einträge nutzt
  ein asynchrones `has` und filtert deshalb nichts; darum prüft ein Gerät, das
  die Liste hat, die alten Einträge erneut, wenn ein neuer Eintrag von jemand
  anderem ankommt. In der Konsole steht dann
  `Could not append entry: Key "<old identity>" is not allowed to write to the log`.
  Dort steht „not allowed“, weil die Identitätsprüfung im `canAppend` des
  Access Controllers sitzt.
- **Warum der Besitz bleibt.** `capabilities().admin` ist die Vereinigung aus
  den Einträgen des Access Controllers und der Schreibliste in seinem Manifest.
  Das Manifest ist ein unsignierter IPFS-Block, den keine Nachweisprüfung
  berührt, deshalb wird die DID des Besitzers dort weiter gefunden.
  Schreibrechte sind signierte Einträge in der eigenen Datenbank des Controllers
  und werden wie Aufgaben abgelehnt.
- **Warum „Ihre Listen“ leer erscheint.** Die Registry ist eine
  OrbitDB-Datenbank, deren Einträge unter dem alten Identitätsdokument signiert
  wurden, also lehnt ein Gerät ohne Kopie sie ebenfalls ab.
- **Relays** behalten die Voreinstellung des Providers und nehmen Nachweise im
  ersten Format weiter an. Die Historie, die sie halten, ist dort gültig und
  bleibt erhalten.
- **Das Kontoverzeichnis von `escrow01`** ist aus demselben Grund in eine neue
  Datenbank umgezogen; siehe
  [Kontozuordnung: technisch](../apps/escrow01/docs/passkey-account.de.md#kontozuordnung-technisch).

## Gemessen

Am 26.11.2026, auf dem E2E-Build jedes Kapitels: ein Origin mit drei Builds
(Provider 0.13.0; 0.14.0 mit Voreinstellung; 0.14.0 ablehnend), ein lokales
Relay auf 0.14.0 mit Voreinstellung und die virtuellen Authenticatoren von
Chromium.

**Ein anderes Gerät.** Alice legte Passkey und Liste auf 0.13.0 an, kam auf dem
ablehnenden Build zurück und schrieb erneut. Danach traten frische Geräte mit
eigenen Passkeys ihrer Liste bei.

| Kapitel        | Abfragen bei Alices Rückkehr (Voreinstellung → ablehnend) | Ein frisches ablehnendes Gerät sieht | Alices Gerät übernimmt die Aufgabe eines Neuen |
| -------------- | --------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `passkey01`    | 0 → 1                                                     | nichts                               | nein                                           |
| `acl01`        | 0 → 1                                                     | nichts                               | nein                                           |
| `delegation01` | 0 → 1                                                     | nichts                               | nein                                           |
| `escrow01`     | 0 → 1                                                     | nichts                               | nein                                           |
| `invoice01`    | 0 → 1                                                     | nichts                               | nein                                           |
| `privacy01`    | 1 → 2                                                     | nichts                               | nein                                           |
| `qr01`         | 0 → 1                                                     | nichts                               | nein                                           |
| `archived01`   | 0 → 1 (1 → 2 mit seiner Standard-Versiegelung)            | nicht messbar¹                       | –                                              |

Ein frisches Gerät auf dem Build mit Voreinstellung sah alle Aufgaben von Alice
in etwa zwei Sekunden; eines auf 0.13.0 sah keine, wie ein veralteter Tab.

¹ In `archived01` gehört eine Liste ihrer DID, ein anderer Passkey erreicht sie
also nie. Der einzige andere Leser ist das zweite Gerät der Besitzerin, und ein
virtueller Authenticator verliert beim Kopieren eines Credentials das
PRF-Geheimnis.

**Die Besitzerin, ohne lokale Kopie** (`escrow01`). Die Besitzerin legte ihre
Liste auf 0.13.0 an, schrieb eine Aufgabe und gab einer DID Schreibrecht. Dann
kam sie zurück, ohne dass der Browser etwas davon hatte.

| Rückkehr                             | 0.13.0 oder Voreinstellung                                  | Ablehnend                                                         |
| ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Arbeitsspeicher-Modus, nach Neuladen | Besitzerin; Aufgabe und Schreibrecht da                     | Besitzerin, kann schreiben; Aufgabe und Schreibrecht fehlen       |
| Frisches Gerät, gleicher Passkey     | die erste Aufgabe öffnet ihre alte Liste, mit ihrer Aufgabe | „Ihre Listen“ ist leer; die erste Aufgabe legt eine neue Liste an |

`acl01`, `delegation01`, `invoice01`, `privacy01` und `qr01` führen Registry
und Schreibrechte genauso. Die Seite der Besitzerin wurde nur in `escrow01`
gemessen.
