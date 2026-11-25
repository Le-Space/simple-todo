# Worauf escrow01 aufbaut

`escrow01` ist das letzte Glied einer Kette von Kapiteln: `collab01` → `passkey01` → `acl01` →
`privacy01` → `delegation01` → `escrow01`. Jeder Abschnitt unten hat ein Glied eingeführt, und jeder
gilt hier weiter. Sie standen früher im README dieses Kapitels; sie sind unverändert hierher
umgezogen, berichtigt nur dort, wo escrow01 es anders macht. Englisch:
[foundations.md](foundations.md).

- [Delegation einzelner Aufgaben (aus `delegation01`)](#-delegation-einzelner-aufgaben-aus-delegation01)
- [Schreibrechte pro DID (aus `acl01`)](#-schreibrechte-pro-did-aus-acl01)
- [Passkey-Identitäten (aus `passkey01`)](#-passkey-identitäten-aus-passkey01)
- [Geteilte Listen über drei Wörter (aus `collab01`)](#geteilte-listen-über-drei-wörter-aus-collab01)

Was escrow01 darüber hinaus ergänzt, steht im [README](../README.de.md) und im
[Rundgang durch den Code](code-tour.de.md).

## 🤝 Delegation einzelner Aufgaben (aus `delegation01`)

Baut auf `acl01` auf. Eine private Liste gehört weiterhin nur ihrer Besitzerin oder ihrem Besitzer —
aber wer sie besitzt, kann jetzt **eine Aufgabe** an eine andere DID abgeben. Diese delegierte DID
darf genau diese Aufgabe erledigen oder umbenennen, sonst nichts, bis die Delegation zurückgenommen
wird oder abläuft. Das ist die Delegations-Hälfte von [de2do](https://github.com/NiKrause/de2do) (die
Treuhand-Hälfte, bei der hinter der Aufgabe Geld in einem Smart Contract steht, ist `escrow01`
selbst), übertragen auf das Fundament von `acl01`: Geteilt wird weiter über die Adresse, die Rechte
stehen weiter im Panel, und die Drei-Wort-Liste bleibt öffentlich.

- **Eine Delegation ist ein Feld der Aufgabe.** Wer die Liste besitzt, schreibt
  `delegation: { delegateDid, grantedAt, expiresAt, revokedAt }` in den eigenen Eintrag der Aufgabe —
  beim Anlegen oder später über den Knopf **Delegieren** der Zeile. Nur das geht, weil nur die
  Schreibmenge diesen Eintrag überschreiben darf. **Zurücknehmen** setzt `revokedAt` auf dieselbe
  Weise.
- **Eine delegierte Person überschreibt die Aufgabe nie.** Ihre Änderung kommt als eigene
  _Delegationsaktion_ hinzu, mit dem Schlüssel `delegation-action/<todoKey>/<delegateDid>/…` und von
  ihr signiert: entweder `set-completed` oder `patch-fields` (`text`/`description`). Wer liest,
  rechnet diese Aktionen in die Aufgabe ein, die sie nennen (`src/lib/delegation.js`).
- **Der Access Controller lässt genau diese zu.** Private Listen öffnen jetzt mit
  [`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo),
  demselben Paket, das de2do und `orbitdb-relay` verwenden. Es umhüllt den Controller aus `acl01` —
  Schreibmenge, Gewähren und Entziehen und das Rechte-Panel bleiben gleich — und lässt zusätzlich
  einen Eintrag durch, wenn er eine wohlgeformte Delegationsaktion ist, deren _Signierer_ die DID in
  ihrem Schlüssel ist. Alles andere von jemandem ohne Schreibrecht wird abgelehnt, wie bisher.
- **Rücknahme und Ablauf entscheidet das Lesen, nicht der Controller.** Der Controller prüft Form und
  Signatur der Aktion; die Aufgabe schlägt er nicht nach. Ob die Aufgabe _gerade_ an diesen Signierer
  delegiert ist, entscheidet, wer liest: Eine Aktion wird ignoriert, außer die Delegation der Aufgabe
  nennt ihren Signierer, ist nicht zurückgenommen und nicht abgelaufen. Eine Rücknahme nimmt also
  auch zurück, was die delegierte Person schon getan hat, und spätere Aktionen nach einer Rücknahme
  landen im Log, ändern aber nichts. Das ist eine Regel auf Seiten des Clients — ein Peer mit anderem
  Code könnte sie weiter anwenden. Das gehört in die eigene App geschrieben; de2do geht denselben
  Kompromiss ein.
- **Der spätere Schreibvorgang der Besitzerin oder des Besitzers gewinnt.** Eine Aktion, die älter ist
  als das eigene `updatedAt` der Aufgabe, fällt weg; so lässt sich eine Aufgabe wieder öffnen, die
  eine delegierte Person erledigt hat. (de2do hat jede Aktion für immer wieder angewendet; das ist
  die eine Stelle, an der die Übertragung abweicht.)
- **Jeder delegierte Schreibvorgang fragt erneut nach dem Passkey.** Gewöhnliche Schreibvorgänge tun
  das nie: Der Signierschlüssel der Identität liegt unverschlüsselt im Keystore (siehe
  _Passkey-Identitäten_ unten). Dass eine delegierte Person die Aufgabe eines anderen ändert, ist das
  eine, was diese Identität auf einer fremden Liste darf, und es soll nicht aus Versehen passieren.
  Das Abzeichen in der Kopfzeile zeigt die Abfrage an (`src/lib/delegated-write-auth.js`).

### Der Typ des Controllers ist nicht Teil der Adresse

Der delegierte Controller meldet `type: 'todo-delegation'`, aber die Adresse, die er ins Manifest
der Liste schreibt, ist die seines umhüllten Basis-Controllers, `/orbitdb/<hash>`. OrbitDB wählt den
Controller für eine Liste, die **über die Adresse** geöffnet wird, nach diesem Präfix — wer also eine
geteilte Liste über ihre Adresse öffnet, und so wird in diesem Tutorial jede Liste geteilt, bekäme
den einfachen `orbitdb`-Controller, und der Schreibvorgang einer delegierten Person würde schon auf
ihrem eigenen Rechner abgelehnt, bevor er überhaupt signiert wäre.

de2do umgeht das, indem es jede Liste **über ihren Namen** öffnet und den Controller ausdrücklich
übergibt; das geht, weil seine Namen ableitbar sind (`<ownerDid>_projects`). Hier werden Listen über
die Adresse geteilt, also nimmt dieses Kapitel den anderen Weg: Der delegierte Controller wird **als
Typ `orbitdb`** registriert (`src/lib/delegated-access.js`). Jeder `/orbitdb/…`-Controller, den
dieser Build öffnet, prüft dann die Delegationsregeln, und das Manifest bleibt eines, das andere
Builds und der Relay weiter öffnen können.

### ⚠️ Was der Relay aus den Einträgen einer delegierten Person macht

`orbitdb-relay` registriert `todo-delegation` — sieht diesen Typ aber aus dem oben genannten Grund nie
in einem Manifest. Er öffnet diese Listen also mit seinem eingebauten `orbitdb`-Controller und
**lehnt Delegationsaktionen beim Replizieren ab**. Alice und Bob tauschen sie direkt aus (das
beweist der E2E-Test); der Relay hält nur die Einträge der Besitzerin. Ist Alice offline, während
Bob erledigt, und treffen sich die beiden nur über den Relay, wartet Bobs Erledigung, bis beide
gleichzeitig online sind. Ein Relay, der diese Einträge annimmt, braucht einen Controller, dessen
_Adresse_ seinen Typ trägt — eine Änderung am Controller-Paket und eine gute Übung für später.

### Aus `privacy01`, abgeschaltet

Dieses Kapitel wurde aus `privacy01` kopiert, und mit ihm kam die Versiegelung einzelner Einträge
aus jenem Kapitel (`db-encryption.js`, `entry-encryption.js`, `database-keys.js`). Nichts hier hat
sie importiert, also ist sie entfernt; `privacy01` und `invoice01` behalten sie. Die Listen hier
sind so unverschlüsselt wie in `acl01`. In `escrow01` sind nur die Budgetbeträge verschlüsselt, auf der
Chain.

Dasselbe gilt für den Signierschlüssel. `privacy01` hat seine Passkey-Identität später auf einen
Schlüssel umgestellt, der nur im Arbeitsspeicher liegt; diese Änderung kam, nachdem dieses Kapitel
kopiert war, also ist die Identität hier noch die aus `acl01`. Ihr Schlüssel folgt der Speicherwahl:
Mit **In diesem Browser behalten** (vorausgewählt) liegt er unverschlüsselt in IndexedDB, ohne den
Haken im Arbeitsspeicher dieses Tabs.

### Durchgang Alice ↔ Bob ↔ Mallory

1. Alice startet in einer eigenen privaten Liste, „Meine Aufgaben“ (in `escrow01` ist der Start eine;
   eine weitere entsteht über **Private Liste anlegen** im Tab „Listen“). Sie trägt eine Aufgabe ein
   und hakt **An eine andere DID delegieren** an, mit Bobs DID (wahlweise mit Ablaufdatum). Sie
   kopiert die Adresse `/orbitdb/…` der Liste.
2. Bob und Mallory öffnen diese Adresse. Beide sehen die Aufgabe; beide werden abgewiesen, wenn sie
   eine eintragen wollen. Bobs Zeile ist als _delegiert_ markiert und ihr Häkchen aktiv; Mallorys
   nicht.
3. Bob hakt die Aufgabe ab. Sein Passkey fragt nach einer Bestätigung, das Abzeichen in der Kopfzeile
   zeigt _Änderung unterschrieben_, und Alices Zeile zeigt _erledigt_ mit _Zuletzt geändert von der
   delegierten DID_. Bob darf sie auch **Umbenennen**. Alles andere auf der Liste gehört weiter allein
   Alice.
4. Alice klickt **Zurücknehmen**. Bobs Erledigung verschwindet auf beiden Seiten — die Aktion liegt
   weiter im Log, aber niemand, der liest, wendet sie an — und sein Häkchen ist wieder inaktiv. In der
   Zeile kann sie **Neu delegieren**, mit oder ohne Ablaufdatum.

## 🔑 Schreibrechte pro DID (aus `acl01`)

Baut auf `passkey01` auf. Passkey-Identitäten bekommen eine _Bedeutung_: Bestimmten DIDs lässt sich
Schreibrecht auf eine eigene Liste geben.

- **Die öffentliche Liste bleibt öffentlich.** Die Drei-Wort-Liste aus `collab01` behält
  `write: ['*']` — offene Zusammenarbeit bleibt, wie sie war.
- **Private Listen gehören nur ihrer Besitzerin oder ihrem Besitzer.** „Private Liste anlegen“ öffnet
  eine neue Datenbank auf OrbitDBs veränderlichem `OrbitDBAccessController` mit
  `write: [eigene Identität]`. Nur man selbst kann schreiben, bis man anderen Rechte gibt.
- **Rechte gewähren und entziehen, im laufenden Betrieb.** Das Rechte-Panel listet die DIDs mit
  Schreibrecht und lässt die Verwaltung der Liste welche hinzufügen oder entfernen. Der Access
  Controller ist selbst eine replizierte OrbitDB-Datenbank, also erreichen Rechte andere Peers,
  **ohne die Adresse der Liste zu ändern**.
- **Geteilt wird über die Adresse.** Eine private Liste wird über ihre volle Adresse `/orbitdb/…`
  geteilt (das Formular „Geteilte Liste über ihre Adresse öffnen“). Lesen und replizieren geht sofort;
  schreiben braucht ein Recht.
- **Abgelehnte Schreibvorgänge scheitern hörbar.** Ein Schreibvorgang einer Identität ohne Recht wird
  in OrbitDBs Prüfung `canAppend` abgelehnt, _bevor_ etwas angehängt wird; nichts sieht also je
  gespeichert aus — die Oberfläche zeigt eine klare Meldung „kein Schreibrecht, bitte die
  Besitzerin oder den Besitzer, die eigene DID hinzuzufügen“, statt abzustürzen.

### Durchgang Alice ↔ Bob

1. Alice legt eine private Liste `alice-todos` an und trägt eine Aufgabe ein. Sie kopiert die Adresse
   `/orbitdb/…`.
2. Bob öffnet diese Adresse und sieht Alices Aufgabe (Lesen und Replizieren funktionieren), aber sein
   eigener Schreibvorgang wird mit einer sichtbaren Meldung **abgelehnt**.
3. Alice fügt Bobs DID im Rechte-Panel ein und gibt ihm Schreibrecht.
4. Bob schreibt erneut → es klappt; beide sehen beide Aufgaben. Umgekehrt (Bob besitzt, Alice ist
   Gast) geht es genauso.

### ⚠️ Versionsverträglichkeit von Relay und Access Controller

Der gewählte Typ des Access Controllers muss dem Relay oder Pinner bekannt sein, der die Liste
repliziert. `orbitdb-relay` registriert `orbitdb`, `orbitdb-deferred` und `todo-delegation`; `acl01`
nutzte den eingebauten Typ `orbitdb`, also brauchte der Relay keine weitere Einrichtung.
`delegation01` wechselt zu
[`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo)
— was das an der Replikation über den Relay ändert und was nicht, steht oben im Abschnitt des
Kapitels.

## 🔐 Passkey-Identitäten (aus `passkey01`)

Das vorige Kapitel (`collab01`) gab jedem Browser eine zufällige Wegwerf-Identität für OrbitDB:
Einträge ließen sich _einem_ Peer zuordnen, aber nicht _einer Person_. Dieses Kapitel ersetzt das
durch eine wählbare **Identität mit Passkey**:

- **Wahl beim Einstieg**, bevor der P2P-Stapel startet: _einen Passkey anlegen_ (der Startknopf; sein
  Name ist nur ein Etikett und wird in der technischen Ansicht abgefragt), _mit einem vorhandenen
  Passkey anmelden_ (Wiederherstellung) oder _ohne Passkey ansehen_ (genau das Verhalten des vorigen
  Kapitels), als Links unter dem Knopf.
- **WebAuthn-DID-Provider** aus
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did):
  Die DID ist der eigene P-256-Schlüssel des Passkeys, und OrbitDB signiert Einträge mit einem
  **secp256k1-Schlüssel, der aus dem Passkey abgeleitet ist** (PRF → HKDF-SHA256; ohne PRF erzeugt der
  Keystore stattdessen einen). Dieser Schlüssel ist **nicht verschlüsselt**: Mit **In diesem Browser
  behalten** liegt er im Keystore von OrbitDB in der IndexedDB dieses Browsers, wo ihn jeder lesen
  kann, der den Speicher des Browsers lesen kann (ohne den Haken im Arbeitsspeicher dieses Tabs). Einen
  Passkey anzulegen kostet drei WebAuthn-Abfragen (Registrieren, PRF, Identitätsnachweis); nach einem
  Neuladen kostet ein behaltenes Credential eine (den Identitätsnachweis), und ein Gerät, das nichts
  behalten hat, drei: zwei zum Wiederherstellen, eine zum Signieren. Auf Sepolia kommt in `escrow01`
  eine hinzu ([wie oft der Passkey fragt](passkey-account.de.md#wie-oft-der-passkey-fragt)). Einträge
  zu signieren fragt nie. (Die strengere Variante _varsig_ — eine Passkey-Abfrage für jeden einzelnen
  Schreibvorgang — steckt im selben Paket und ist eine gute Übung für später, wird hier aber nicht
  verwendet.)
- **Anlegen oder wiederherstellen** (`src/lib/passkey-identity.js`): Das Credential wird nur dann in
  `localStorage` geschrieben, wenn man Daten behalten wollte. Die Wiederherstellung nimmt diese Kopie,
  wenn es sie gibt, und fragt sonst den Authenticator selbst: `restoreIdentityFromAuthenticator`
  (Provider 0.8.0) gewinnt die DID aus zwei Signaturen und den Signierschlüssel aus der PRF-Ausgabe.
  So kommt ein Gerät, das diesen Passkey nie gesehen hat — oder ein neues mit demselben
  Sicherheitsschlüssel —, ohne gespeicherte Daten zur selben Identität und zum selben Budget-Konto
  zurück. Eine `largeBlob`-Schicht gibt es nicht mehr; sie hat nie etwas geschrieben
  ([Provider #48](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/48)).
  Dieser Ablauf lebt derzeit hier — ihn ins Provider-Paket zu übernehmen, ist ein offener Punkt.
- **Sichtbare Identität**: Die eigene DID steht in der Kopfzeile (in `escrow01` im Tab „Konto“;
  gekürzt, mit Knopf zum Kopieren), und jede Aufgabe zeigt ihre Autorin oder ihren Autor, aufgelöst
  aus `entry.identity` — dem Feld, das OrbitDB selbst signiert; es lässt sich also nicht fälschen,
  indem man einen anderen Namen in die Aufgabe schreibt.
- **Die Zugriffskontrolle blieb** in `passkey01` **unverändert** (`write: ['*']`): Jenes Kapitel ging
  nur darum, _wer man ist_, noch nicht darum, _wer schreiben darf_. Das hat `acl01`, oben, ergänzt.

### Der eingegebene Name ist ein Etikett, nicht die Identität

Das Formular beim Einstieg fragt nach einem Namen, und nichts hängt davon ab. Ein Passkey trägt zwei
lesbare Felder (`user.name` und `displayName`), die nur dazu da sind, dass die Passkey-Auswahl des
Browsers etwas anzeigen kann. Was das Credential kennzeichnet, ist das **User Handle**, 64
Zufallsbytes, die der Identity Provider erzeugt — und die DID kommt aus dem öffentlichen Schlüssel des
Credentials, nicht aus einem der beiden. Zwei Personen auf demselben Gerät können denselben Namen
eingeben und bekommen trotzdem zwei getrennte Identitäten.

Das ist erwähnenswert, weil es nicht immer so war. Solange das Handle aus dem eingegebenen Namen
abgeleitet wurde, hat ein Authenticator — der ein Credential pro (Ursprung, Handle) hält — den
früheren Passkey still **ersetzt**, wenn eine zweite Person denselben Namen benutzte, und die DID und
alles darunter Signierte mitgenommen
([Provider #45](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/45)). Die
WebAuthn-Spezifikation sagt, das Handle dürfe keine persönlichen Daten wie einen Benutzernamen oder
eine E-Mail-Adresse enthalten und solle zufällig sein, aus genau diesem Grund.

### ⚠️ Passkeys sind an den Ursprung gebunden (rpId)

Ein WebAuthn-Credential gilt für die Domain, die es angelegt hat. Ein auf `http://localhost:5173`
registrierter Passkey existiert auf `https://simple-todo.le-space.de` **nicht**, und ein Passkey von
einem IPFS-Gateway (`dweb.link`) ist auf einem anderen (`ipfs.aleph.im`) unsichtbar — selbst bei
identischem Build der App. Für eine Local-First-App, die über viele Gateways verteilt wird, ist das
eine echte Grenze: Die DID wandert über Geräte nur per Passkey-Synchronisierung (iCloud-Schlüsselbund,
Google Passwortmanager, …), nicht über Ursprünge hinweg. Wenn stabile Identitäten zählen, eine
kanonische Domain festlegen.

**Android ohne Google-Play-Dienste** (GrapheneOS): Die PRF-Erweiterung, aus der die Identität
abgeleitet wird, braucht einen Credential Provider, der CTAP2 selbst umsetzt — welcher das tut, wie
man ihn einrichtet und was das Kapitel ohne PRF tut, steht in
[docs/grapheneos.md](../../../docs/grapheneos.md) (Englisch).

## Geteilte Listen über drei Wörter (aus `collab01`)

`collab01` hat das Grund-Tutorial `main` um einen spanischen Teilen-Code aus drei Wörtern erweitert,
zum Beispiel `luna-camino-verde`. Die normalisierten Wörter sind der Name der OrbitDB-Datenbank: Zwei
Browser geben dieselben Wörter ein, um dieselbe Liste zu öffnen und zu replizieren, ohne eine volle
OrbitDB-Adresse auszutauschen. Die Wörter sind nur ein bequemer, öffentlicher Teilen-Code — kein
Passwort, keine Wiederherstellungsphrase, kein Schlüssel und keine Zugriffskontrolle. Wer sie kennt
oder errät, kann die öffentlich beschreibbare Liste finden und ändern.

In `escrow01` ist diese Liste nicht mehr der Ort, an dem man startet. Ohne Link endet der Start in
einer eigenen privaten Liste („Meine Aufgaben“), weil es Delegation und Budgets nur dort gibt. Die
Drei-Wort-Liste des Browsers wird weiter im Hintergrund geöffnet, und sie ist weiter der Weg, eine
öffentliche Liste zu teilen:

1. **Zwei Browserfenster öffnen** — zwei Browser, ein Mobilgerät oder eine andere Person anderswo.
2. **In beiden dieselbe Adresse laden.**
3. **Die geteilte Liste wählen** — den **Teilen-Code** aus drei Wörtern im Tab **Listen** des ersten
   Browsers kopieren. Im zweiten unter dem Startknopf **Einstellungen** öffnen, **Einer geteilten
   Liste beitreten** anhaken und die Wörter einfügen. Ein Link mit den Wörtern (`#list=…`) tut
   dasselbe; ebenso der QR-Code der Seite, solange diese Liste offen ist.
4. **Starten** — den Startknopf drücken: Der Druck ist die Zustimmung.
5. **Auf die Verbindung warten** — die App findet den anderen Peer und verbindet sich.
6. **Aufgaben eintragen** in einem Browser und zusehen, wie sie im anderen erscheinen. Auf einer
   geteilten Liste sagt das Formular, dass Delegation eine private Liste braucht, und bietet an, eine
   anzulegen.

## Selbst ausprobieren

### Delegation

Es braucht drei Passkeys — drei Browser oder drei Profile eines Browsers:

1. In Browser A (Alice) **Passkey anlegen und starten** drücken. Man ist in der eigenen privaten
   Liste, „Meine Aufgaben“. Eine Aufgabe eintippen, **An eine andere DID delegieren** anhaken und die
   **Passkey-DID** von Browser B einfügen (sein Tab „Konto“). Hinzufügen — die erste Aufgabe legt die
   Liste an — und dann die Adresse `/orbitdb/…` kopieren.
2. In den Browsern B (Bob) und C (Mallory), jeder mit eigenem Passkey, die Adresse in **Geteilte
   Liste über ihre Adresse öffnen** einfügen (Tab „Listen“). Beide sehen die Aufgabe, und beide
   werden abgewiesen, wenn sie eine eintragen. Nur in B ist das Häkchen aktiv.
3. In B die Aufgabe abhaken: Die Passkey-Abfrage erscheint, die Kopfzeile zeigt _Änderung
   unterschrieben_, und die Zeile in A ändert sich. In B in der Zeile **Umbenennen** klicken und
   zusehen, wie der neue Name in A und C ankommt.
4. In A in der Zeile **Zurücknehmen** klicken. Das Häkchen verschwindet in A und B, und in B ist es
   inaktiv. Mit **Neu delegieren** in der Zeile wieder abgeben, diesmal mit einem Ablauf eine Minute
   später, und zusehen, wie es _abgelaufen_ wird.

`pnpm exec playwright test e2e/delegation.spec.js` spielt das mit drei virtuellen Authenticatoren
durch.

### Schreibrechte

Die Drei-Wort-Liste oben bleibt öffentlich. Um die Zugriffskontrolle auszuprobieren, eine **private
Liste** nehmen und über die Adresse teilen:

1. In Browser A (Besitz) **Passkey anlegen und starten** drücken, eine Aufgabe in „Meine Aufgaben“
   eintragen und die angezeigte Adresse `/orbitdb/…` kopieren. (**Private Liste anlegen** im Tab
   „Listen“ legt eine weitere an.)
2. In Browser B (Gast) einen _anderen_ Passkey anlegen, die Adresse in **Geteilte Liste über ihre
   Adresse öffnen** einfügen (Tab „Listen“) und öffnen. Die Aufgabe aus A ist zu sehen, aber eine
   eigene einzutragen wird mit einer sichtbaren Meldung **abgelehnt**.
3. In Browser A die **Passkey-DID** von Browser B (sein Tab „Konto“) im Panel **Schreibrechte** (Tab
   „Listen“) einfügen und **DID hinzufügen** klicken.
4. In Browser B die Aufgabe erneut eintragen → es klappt, und beide Browser gleichen sich an. Besitz
   und Gast sind symmetrisch — auch umgekehrt ausprobieren.

Derselbe Ablauf Schritt für Schritt steht oben im [Durchgang Alice ↔ Bob](#durchgang-alice--bob).
