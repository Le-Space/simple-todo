# Ein Rundgang durch den Code

Für alle, die `escrow01` als Schritt des Tutorials lesen: was das Kapitel zu `delegation01` hinzufügt,
in der Reihenfolge, in der es sich am leichtesten liest, und wie eine Sperre vom Formular bis zur
Chain wandert. Was es erbt, steht in [foundations.de.md](foundations.de.md). Englisch:
[code-tour.md](code-tour.md).

## Lesereihenfolge

Das Kapitel hält seine Treuhand vom Rest getrennt, sie lässt sich also für sich lesen. Das meiste
liegt hinter einer Schnittstelle; erst die lesen, dann die eine Seite, dann die andere.

| #   | Datei                                                                                                                                                                                                                                                                                                                                                                    | Was sie zeigt                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol)                                                                                                                                                                                                                                                                                | die Treuhand auf der Chain: `lock`, `release`, `refund`, `escrowOf`; ein verschlüsselter Betrag (`euint64`) pro Ersteller und `todoRef`; wer ihn entschlüsseln darf (`FHE.allow`)                                                                                                       |
| 2   | [`src/lib/budget/budget.js`](../src/lib/budget/budget.js)                                                                                                                                                                                                                                                                                                                | das Feld `budget` einer Aufgabe und seine Zustände, als reine Funktionen: OrbitDB hält Status und Verweise, nie den Betrag                                                                                                                                                              |
| 3   | [`src/lib/budget/budget-service.js`](../src/lib/budget/budget-service.js)                                                                                                                                                                                                                                                                                                | die eine Schnittstelle, durch die jede Budget-Operation geht, und welche Umsetzung `VITE_BUDGET_SERVICE` wählt                                                                                                                                                                          |
| 4   | [`src/lib/budget/budget-service-fake.js`](../src/lib/budget/budget-service-fake.js)                                                                                                                                                                                                                                                                                      | die Schnittstelle im Arbeitsspeicher: die Regeln des Vertrags ohne Chain, das, was die Tests und ein Build ohne Sepolia nutzen                                                                                                                                                          |
| 5   | [`src/lib/budget/budget-flow.js`](../src/lib/budget/budget-flow.js)                                                                                                                                                                                                                                                                                                      | Sperren und Freigeben Schritt für Schritt, jeder Schritt in die Aufgabe geschrieben, bevor der nächste beginnt                                                                                                                                                                          |
| 6   | [`src/lib/budget/budget-store.js`](../src/lib/budget/budget-store.js)                                                                                                                                                                                                                                                                                                    | der Dienst der Sitzung, entschlüsselte Beträge nur im Arbeitsspeicher, der Zustand des Kontos, das Warten auf Auszahlungen                                                                                                                                                              |
| 7   | [`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js)                                                                                                                                                                                                                                                                                      | dieselbe Schnittstelle auf Sepolia: das Konto des Passkeys, Verschlüsselung im Browser, der Leseschlüssel und sein Siegel                                                                                                                                                               |
| 8   | [`src/lib/chain/`](../src/lib/chain)                                                                                                                                                                                                                                                                                                                                     | das Wie, nicht das Was: `sepolia-chain.js` (RPC, User Operations, Calibur), `zama-client.js` (Zamas SDK), `account-directory.js` (welches Konto zu einer DID gehört), `account-store.js` und `read-key-seal.js` (was dieser Browser behält, und wie versiegelt), `config.js` (Adressen) |
| 9   | [`src/lib/AddTodoForm.svelte`](../src/lib/AddTodoForm.svelte), [`TodoItem.svelte`](../src/lib/TodoItem.svelte), [`BudgetChip.svelte`](../src/lib/budget/BudgetChip.svelte), [`BudgetNotices.svelte`](../src/lib/budget/BudgetNotices.svelte), [`BalanceCard.svelte`](../src/lib/budget/BalanceCard.svelte), [`AuditorView.svelte`](../src/lib/budget/AuditorView.svelte) | das Budget auf dem Bildschirm: das Feld im Formular, das Abzeichen an der Zeile, was schiefging, das Guthaben, die Prüfansicht                                                                                                                                                          |
| 10  | [`src/lib/explanations/`](../src/lib/explanations), [`TechnicalExplanation.svelte`](../src/lib/TechnicalExplanation.svelte)                                                                                                                                                                                                                                              | jeder Schritt zweimal erklärt: einfach, und ausführlich, wenn „Technisch“ an ist                                                                                                                                                                                                        |
| 11  | [`src/routes/+page.svelte`](../src/routes/+page.svelte), [`src/lib/start/`](../src/lib/start), [`home-list.js`](../src/lib/home-list.js)                                                                                                                                                                                                                                 | der Start: ein Passkey (`start` und `beginWith` auf der Seite, `passkeyPromptsFor` in `start/identity.js`) und eine eigene private Liste (`openStartList` auf der Seite, `openHomeList` in `home-list.js`)                                                                              |

Wo Code der Treuhand in einer geerbten Datei steht, ist er meist mit einem Kommentar `escrow01:`
markiert. Die Seite behält den Ablauf des Starts; die Teile, die nichts von ihrem Zustand brauchen,
liegen daneben in [`src/lib/start/`](../src/lib/start) und [`src/lib/sections/`](../src/lib/sections)
(Kopfzeile, Tab „Konto“ und Tab „Netzwerk“). [`src/lib/relay-proof.js`](../src/lib/relay-proof.js) ist
geerbt und gehört nicht zur Lektion: die Anzeige, dass der Relay den Eintrag einer Aufgabe bestätigt hat, erfragt über eine
veraltete Route des Relays.

## Wie eine Sperre wandert

Alice trägt eine Aufgabe ein, an Bob delegiert, mit 500,00 im Budget-Feld:

1. `handleAddTodo` in `+page.svelte` legt zuerst ihre private Liste an, wenn der Start nur auf sie
   gezeigt hat (`openHomeList(…, { create: true })`), und ruft dann `addTodoWithBudget` in
   `budget-store.js` auf.
2. `prepareLock` in `budget-flow.js` holt sich beim Dienst eine `todoRef` und gibt ein Budget im
   Zustand „wird gesperrt“ zurück. Der Betrag bleibt im Arbeitsspeicher des Stores
   (`rememberAmount`).
3. `addTodo` in `db-actions.js` schreibt die Aufgabe mit diesem Budget in OrbitDB. Die Liste zeigt
   jetzt „wird gesperrt“; das Formular ist wieder frei.
4. `lockBudget` läuft im Hintergrund weiter: `finishLock` ruft `lock` des Dienstes auf, das den
   Passkey fragt. Auf Sepolia ist das eine User Operation: Der Browser verschlüsselt 500,00 für die
   Treuhand und Alices Konto, Openfort zahlt das Gas, und die Treuhand speichert den verschlüsselten
   Betrag.
5. `finishLock` schreibt das Ergebnis in die Aufgabe („gesperrt“ oder den Fehler), und
   `BudgetNotices` erklärt einen Fehlschlag. Bobs Browser bekommt die Aufgabe über OrbitDB und liest
   den Betrag über die Entschlüsselung des Dienstes, nie aus der Aufgabe.

Eine Freigabe geht denselben Weg: `releaseTodoBudget` → `releaseBudgetOf` → `release` des Dienstes,
jeder Schritt in die Aufgabe geschrieben. Die Einzelheiten auf der Chain stehen in
[passkey-account.de.md](passkey-account.de.md#budget-sperren-wo-verschlüsselt-wird) und
[escrow.de.md](escrow.de.md).

## Was das Kapitel tut

Die lange Form dessen, was das [README](../README.de.md) in einer Tabelle sagt.

Baut auf `delegation01` auf. Eine delegierte Aufgabe kann ein Budget tragen: Wer sie besitzt, sperrt
einen Betrag eines vertraulichen Tokens für die delegierte Person, gibt ihn frei, wenn die Aufgabe
erledigt ist, oder holt ihn nach einer Frist zurück. Der Betrag ist mit Zamas FHEVM verschlüsselt, die
Chain zeigt also, wer für wen wann Geld gesperrt hat, aber nicht, wie viel. Entschlüsseln können ihn
die Besitzerseite, die delegierte Person und eine im Vertrag festgelegte Prüfstelle; die Ausnahmen
und das Vertrauen in Zamas Schlüsselhalter stehen in [security.de.md](security.de.md). Das ist die
Treuhand-Hälfte von [de2do](https://github.com/NiKrause/de2do).

- **Der Vertrag ist live.** [`ConfidentialTodoEscrow`](../contracts/src/ConfidentialTodoEscrow.sol)
  nimmt einen vertraulichen ERC-7984-Token an (Zamas cUSDTMock auf Sepolia) und führt jede Treuhand
  unter ihrem Ersteller und einer `todoRef`, gedacht als gesalzener Hash. Er ist auf Sepolia unter
  [`0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code)
  bereitgestellt und auf Etherscan, Sourcify und Blockscout verifiziert. Ein Smoke-Test hat dort am
  2026-09-16 einen echten Betrag gesperrt, entschlüsselt und freigegeben.
- **Ein Passkey bezahlt, auf Sepolia.** Eine delegierte Aufgabe kann beim Anlegen ein Budget sperren,
  die Besitzerseite gibt es frei, sobald die delegierte Person fertig ist, die delegierte Person
  erfährt von der Auszahlung, und eine Prüfansicht listet die Treuhand-Vorgänge. Gebaut mit
  `VITE_BUDGET_SERVICE=zama` und einem Openfort-Schlüssel bekommt jeder Passkey im Hintergrund ein
  Konto, das über EIP-7702 Calibur folgt, einem nicht aktualisierbaren Wallet-Smart-Contract von
  Uniswap Labs; eine Sperre oder Freigabe ist eine User Operation, die der Passkey signiert, das Gas
  sponsert Openfort, und Beträge werden im Browser ver- und entschlüsselt. Ein Lauf am 2026-09-17 hat
  das alles zwischen zwei Browsern getan ([passkey-account.de.md](passkey-account.de.md)). Gelesen
  werden Beträge über einen Leseschlüssel, an den das Konto die Entschlüsselung delegiert; der Browser
  behält ihn nur versiegelt, unter einem Schlüssel, den der Passkey ableitet, und „Beträge anzeigen“
  öffnet ihn einmal pro Besuch.
- **Ohne diese Einstellungen eine Attrappe.** Sie verschlüsselt nichts und vergisst ihre Vorgänge beim
  Neuladen; der Tab „Konto“ sagt „Demo ohne Chain“. Die Tests laufen gegen sie.
- **OrbitDB speichert keine Beträge.** Das Feld `budget` einer Aufgabe hält Status, Token, Treuhand,
  `todoRef`, Transaktions-Hashes und den letzten Fehler. Was gesperrt ist, weiß verbindlich die Chain.
- **Der Startdialog sagt, wofür das ist, und hat einen Knopf.** Sein Titel nennt den Zweck —
  vertrauliche Treuhand-Zahlungen per Passkey — und sein erster Bildschirm enthält das Versprechen,
  **Anmelden · Unterschreiben · Bezahlen** als eine Zeile mit **Bezahlen** hervorgehoben, drei Sätze
  zu den Daten (Beträge verschlüsselt; Aufgaben und Listen nicht; am sichersten in einem Browser ohne
  Erweiterungen) und einen Knopf, der sagt, was er tut: **Passkey anlegen und starten**. Der Druck ist
  die Zustimmung; die Zeile darunter sagt das. Die anderen Wege hinein sind Links darunter: „Schon
  einen Passkey? Damit anmelden“ und „Ohne Passkey ansehen – dann ohne Budget“. „Hinweise und
  Einstellungen“ ist ein zweiter Bildschirm im selben Dialog: **In diesem Browser behalten**
  (angehakt; auf einem geteilten Rechner abhaken), **Einer geteilten Liste beitreten** (das Feld für
  den Teilen-Code erscheint auf Wunsch), die technische Ansicht und alle Hinweise. Behalten ist ein
  Wiederkommen mit Passkey ein Tippen („Willkommen zurück“), und ohne Passkey öffnet die App sofort;
  ohne Haken wird nichts behalten, nicht einmal die Entscheidung, also kommt der Dialog wieder.
- **Der Start endet in einer eigenen Liste.** Ohne Link zeigt der Start auf eine private Liste, „Meine
  Aufgaben“, die mit der ersten Aufgabe entsteht (`openHomeList` in
  [`home-list.js`](../src/lib/home-list.js)); ein Wiederkommen findet sie wieder. Ein Link mit drei
  Wörtern (`#list=`) öffnet stattdessen diese geteilte Liste, wo das Formular sagt, dass Delegation
  eine private Liste braucht; ein Link mit einer Adresse (`#db=`) öffnet diese Liste.
- **Zum Weitergeben gibt es nur die Liste auf dem Schirm.** Die Drei-Wort-Liste des Browsers bleibt
  unter der eigenen offen. Bis die erste Aufgabe „Meine Aufgaben“ anlegt, tragen Adresszeile und
  QR-Code der Seite deshalb keine Liste, und der Tab **Listen** kopiert nichts. Er nennt die drei
  Wörter neben der offenen Liste, mit **Diese Liste öffnen** (`openSharedList` in
  [`db-actions.js`](../src/lib/db-actions.js)): kein Neustart, keine Passkey-Abfrage, und von da an
  führen die Wörter, der Link und der QR-Code dorthin, wo die eigenen Aufgaben landen.
- **Ein Licht sagt, wie der andere Browser verbunden ist.** Unter dem Listennamen: weiß, kein anderer
  Browser; grün, eine direkte WebRTC-Verbindung; gelb, nur über den Relay. Es liest
  `connection.limits`, nicht die Adresse ([`list-peers.js`](../src/lib/list-peers.js)).
- **Ein Demo-Video, sobald es eins gibt.** Ein Vorschaubild links in der obersten Zeile des Dialogs
  und ein Link „Video“ in der Kopfzeile öffnen einen Player über der Seite; er spielt eine Datei
  dieser Seite ab, mit einem einfachen Link zu YouTube daneben. Beides bleibt verborgen, bis
  [`src/lib/demo-video.js`](../src/lib/demo-video.js) einen Eintrag für die angezeigte Sprache hat.
- **Die Seite öffnet mit den Aufgaben.** Listen, Konto und Netzwerk sind Tabs, auf dem Handy am
  unteren Rand, sonst unter der Kopfzeile. Das Fragment der Adresse nennt den Tab, also führen
  `#listen`, `#konto`, `#netzwerk` und `#pruefstelle` der Prüfansicht direkt dorthin.
