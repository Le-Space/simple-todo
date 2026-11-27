# Sicherheit der vertraulichen Treuhand

Für Sicherheits- und Kryptographie-Gutachter des Kapitels `escrow01`. Das Dokument legt dar, was die
Treuhand und die versiegelten Listen schützen, was sie offenlegen, wem sie vertrauen und was nicht
gelöst ist. Die Fakten haben den Stand 2026-09-16, die zur Passkey-Wallet den Stand 2026-09-17, die
zu versiegelten Listen den Stand 2026-11-27 (#176), und sind am Ende belegt; Punkte, die sich nicht verifizieren ließen, sind als solche
gekennzeichnet. Die Mechanik beschreiben [escrow.de.md](escrow.de.md) und
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md); der nachverfolgte Lauf
steht in [smoke-test.de.md](smoke-test.de.md).

Status: eine Demonstration im Testnetz. `ConfidentialTodoEscrow` ist auf Sepolia deployt und
verifiziert und wurde nicht auditiert. Mit `VITE_BUDGET_SERVICE=zama` gebaut, sperrt, liest und gibt
die App Budgets auf Sepolia aus einem Passkey-Konto frei, das Gas sponsert Openfort
([passkey-account.de.md](passkey-account.de.md)); ohne diese Einstellung laufen die Budget-Ansichten
gegen eine Attrappe im Arbeitsspeicher, die nichts verschlüsselt.

- [Bedrohungsmodell](#bedrohungsmodell-einfach)
- [Was sichtbar wird](#was-sichtbar-wird-einfach)
- [Vertrauensannahmen](#vertrauen-einfach)
- [Der Token: cUSDTMock](#token-einfach)
- [Die Prüfstelle](#prüfstelle-einfach)
- [Input-Proofs und Wiederverwendung](#wiederverwendung-einfach)
- [Eigenschaften der Treuhand selbst](#eigenschaften-der-treuhand-einfach)
- [Grenzen](#grenzen-einfach)
- [Passkey-Wallet](#passkey-wallet)
- [Versiegelte Listen](#versiegelte-listen)
- [Offene Punkte](#offene-punkte)

## Bedrohungsmodell

### Bedrohungsmodell: einfach

Die Treuhand soll eine Sache geheim halten: wie viel Geld gesperrt und ausgezahlt wird. Sie soll nicht
verbergen, wer wem zahlt oder wann. Sie verlässt sich darauf, dass Zamas Schlüsselverwalter den
Entschlüsselungsschlüssel aufgeteilt halten und dass Zamas Dienste verfügbar sind.

Die Listen der App sind eine zweite Sache. Seit #176 ist eine private Liste versiegelt: Ihre Todos
lesen nur die Personen, mit denen sie geteilt ist; der Relay, der eine Kopie behält, liest sie nicht.
Wer wann hineingeschrieben hat und wer welchen Schlüssel hat, bleibt sichtbar. Die geteilte Liste hinter
drei spanischen Wörtern ist nicht versiegelt: Wer die Wörter kennt, liest und beschreibt sie.

### Bedrohungsmodell: technisch

Schutzgüter:

1. Vertraulichkeit der Beträge: gesperrte Beträge, die Token-Guthaben der Treuhand und der Beteiligten.
2. Integrität der Mittel: Nur der Ersteller gibt frei oder zahlt zurück; eine Freigabe zahlt dem
   Begünstigten den tatsächlich gesperrten Betrag aus; nichts anderes bewegt einen gesperrten Betrag.
3. Verfügbarkeit: Ein Ersteller kann freigeben oder zurückzahlen, und berechtigte Beteiligte können
   Beträge lesen.
4. Schutz der Metadaten: ausdrücklich außerhalb des Umfangs, siehe
   [Was sichtbar wird](#was-sichtbar-wird-technisch).
5. Vertraulichkeit einer versiegelten Liste: jedes Feld eines Todos, der Name der Liste, die
   Umbenennung durch eine delegierte Person. Ihre Metadaten sind nicht geschützt
   ([Was sichtbar wird](#was-sichtbar-wird-technisch), [Versiegelte Listen](#versiegelte-listen-technisch)).

Angreifer und was sie können:

| Angreifer                                                                                                    | Kann                                                                                                                                                | Kann nicht                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beobachter der Chain                                                                                         | jede Transaktion, alle Calldata, jedes Event und jeden Storage-Slot auf Sepolia sowie die Events der Gateway-Chain lesen                            | ein Handle entschlüsseln; eine vollständige Sperre von einer ungedeckten unterscheiden                                                                      |
| Front-Runner                                                                                                 | einen ausstehenden `lock`-Aufruf kopieren (`todoRef`, Handle, Proof)                                                                                | den Proof für ein anderes Konto oder einen anderen Vertrag verwenden; die `todoRef` des Erstellers belegen (Treuhand-Vorgänge sind pro Ersteller indiziert) |
| Leser einer offenen Liste                                                                                    | alles darin lesen: Todo-Text; in einer privaten Liste von vor #176 auch DID des Delegierten und `budget` (`todoRef`, Transaktions-Hashes, Status)   | Beträge lesen; sie stehen nicht in OrbitDB                                                                                                                  |
| Wer die Adresse einer versiegelten Liste hat, der Relay eingeschlossen                                       | ihre Metadaten lesen: Eintragsschlüssel, Signierer, die Schreibliste, wer welchen Schlüssel hat ([Was sichtbar wird](#was-sichtbar-wird-technisch)) | ein Todo, den Namen der Liste oder eine Umbenennung durch eine delegierte Person lesen; einen Schlüssel in der Schlüsselablage unterschieben (#120)         |
| Eigentümer, schreibberechtigte, delegierte oder entfernte schreibberechtigte Person einer versiegelten Liste | siehe [Versiegelte Listen](#versiegelte-listen-technisch)                                                                                           |                                                                                                                                                             |
| Begünstigter                                                                                                 | den gesperrten Betrag und das eigene Guthaben lesen; vor Arbeitsbeginn prüfen, dass die Sperre nicht leer ist                                       | eine Freigabe erzwingen                                                                                                                                     |
| Ersteller                                                                                                    | eine Freigabe zurückhalten und nach der Frist zurückzahlen                                                                                          | an jemand anderen als den eingetragenen Begünstigten freigeben; vor der Frist Mittel entnehmen, ohne freizugeben                                            |
| Prüfstelle                                                                                                   | jeden jemals in dieser Treuhand gesperrten Betrag lesen                                                                                             | Mittel bewegen                                                                                                                                              |
| Owner (Eigentümer) des Tokens (Protocol DAO)                                                                 | ein Upgrade von cUSDTMock durchführen, Observer hinzufügen, die entschlüsseln können, Adressen blockieren, einen Pauser ernennen                    | durch Code ist nichts ausgeschlossen; siehe [Der Token](#token-technisch)                                                                                   |
| Zama-Betreiber                                                                                               | siehe Abschnitt [Vertrauensannahmen](#vertrauen-technisch)                                                                                          |                                                                                                                                                             |
| Kompromittierter Browser oder Schlüssel                                                                      | alles lesen, was dieser Schlüssel entschlüsseln darf; als dieses Konto signieren                                                                    | Beträge lesen, für die er keine ACL-Berechtigung hat                                                                                                        |
| Wer den Openfort-Schlüssel der Seite hat                                                                     | jede UserOperation auf Sepolia nach der Regel des Projekts sponsern lassen                                                                          | für ein Konto signieren, Mittel bewegen, Beträge lesen                                                                                                      |

Ersteller, Begünstigter und Prüfstelle können einen gesperrten Betrag außerdem jeweils über den Token
öffentlich machen (siehe [Der Token](#token-technisch)).

## Was sichtbar wird

### Was sichtbar wird: einfach

Alle können sehen, wer für wen Geld gesperrt hat, wann, bis wann, welche Treuhand-Referenz verwendet
wurde und wann es ausgezahlt wurde. Alle können sehen, wie viel zwischen USDT und vertraulichem USDT
umgewandelt wurde. Niemand kann sehen, wie viel gesperrt oder ausgezahlt wurde. Zamas Systeme
erfassen außerdem, wer die Entschlüsselung welches Werts angefordert hat, und wann.

In den Listen der App hängt es von der Liste ab. Die Liste hinter drei spanischen Wörtern ist offen:
Wer die Wörter kennt, liest und beschreibt sie ganz. Eine private Liste, die seit #176 angelegt
wurde, ist versiegelt: Der Relay und alle mit ihrer Adresse bekommen nur verschlossene Einträge,
nicht die Todos, nicht den Namen der Liste, nicht die Treuhand-Referenz. Sie sehen weiterhin, wer
wann hineingeschrieben hat, wer hineinschreiben darf und wer einen Schlüssel zu welchem Todo bekommen
hat. Private Listen von vor #176 bleiben offen.

### Was sichtbar wird: technisch

Öffentlich auf Sepolia (alles in den Transaktionen des Smoke-Test-Laufs bestätigt):

| Offenlegung                                              | Wo                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Absender (Ersteller)                                     | `from` der Transaktion; Topic 1 von `Locked`                                                                                             |
| Empfänger (Begünstigter)                                 | Calldata von `lock`; Topic 3 von `Locked`; ACL-Event `Allowed`; später Topic 2 von `ConfidentialTransfer`                                |
| Adresse der Prüfstelle                                   | `auditor()`; ein ACL-Event `Allowed` in jeder Sperre                                                                                     |
| Zeitpunkt                                                | Block-Zeitstempel von `setOperator`, `lock`, `release`, `refund`                                                                         |
| Funktion                                                 | Methodenselektor (Etherscan: "Lock", "Release")                                                                                          |
| `todoRef`                                                | Calldata; Topic 2 von `Locked`, `Released`, `Refunded`                                                                                   |
| Frist                                                    | Calldata; Datenteil von `Locked`                                                                                                         |
| Operator-Zeitfenster                                     | Calldata von `setOperator` und Event `OperatorSet`                                                                                       |
| Gas und Gebühr                                           | Receipt                                                                                                                                  |
| Identität der Handles                                    | Calldata, FHEVMExecutor-Events, `ConfidentialTransfer`, `Allowed`, `escrowOf`, `confidentialBalanceOf`                                   |
| Berechnungsgraph                                         | jede FHE-Operation mit ihren Operanden- und Ergebnis-Handles in FHEVMExecutor-Events                                                     |
| Input-Proof                                              | Calldata; Event `VerifyInput`                                                                                                            |
| Beträge beim Verpacken und Entpacken                     | Calldata von `wrap`, ERC-20 `Transfer`, `TrivialEncrypt(pt)`, `Wrap(roundedAmount)`; Calldata von `finalizeUnwrap` und `UnwrapFinalized` |
| Anzahl der Treuhand-Vorgänge und Freigaben pro Ersteller | Anzahl der Events `Locked` und `Released`                                                                                                |

Was die Identität der Handles verrät: Gleiche Handles bezeichnen gleiche Werte. Ein berechnetes Handle
ist ein Hash öffentlicher Daten, und die Executor-Events zeigen, welche Handles in welche Operation
eingehen. Die Wiederverwendung eines Handles, etwa das erneute Sperren des Betrags eines früheren
Treuhand-Vorgangs mit leerem Proof, zeigt öffentlich, dass beide Operationen vom selben verschlüsselten
Wert ausgingen. Triviale Verschlüsselungen veröffentlichen ihren Klarwert konstruktionsbedingt
(`TrivialEncrypt(pt)`).

Korrelation: Ein Verpacken von X kurz vor einer Sperre durch dieselbe Adresse legt einen gesperrten
Betrag von höchstens X nahe. Ein Entpacken durch einen Begünstigten kurz nach einer Freigabe legt den
freigegebenen Betrag nahe.

Außerhalb von Sepolia:

- **Gateway-Chain.** Jede Nutzer-Entschlüsselung ist eine Gateway-Transaktion des Relayers, die
  `UserDecryptionRequest(decryptionId, ciphertext materials including the handles, userAddress,
publicKey, extraData)` emittiert, gefolgt von einem `UserDecryptionResponse` pro KMS-Anteil. Wer
  welches Handle zu lesen angefragt hat, und wann, ist daher auf der Gateway-Chain öffentlich, für die
  Zama einen öffentlichen Block-Explorer betreibt (`https://explorer.testnet.zama.org` für das
  Testnet); die Anteile selbst sind für den ML-KEM-512-Schlüssel des Anfragenden verschlüsselt.
  Ergebnisse öffentlicher Entschlüsselungen werden dort im Klartext veröffentlicht.
- **Relayer.** Sieht jede Anfrage mit Adressen, Handles und öffentlichen Transportschlüsseln sowie die
  IP-Adresse des Clients.
- **OrbitDB, offene Listen.** Die Liste hinter drei Wörtern ist offen
  (`IPFSAccessController({ write: ['*'] })`): Wer ihre Wörter kennt, liest und beschreibt jedes Todo.
  Sie kann nicht delegieren und enthält daher nie ein Budget. Eine private Liste von vor #176 bleibt
  unversiegelt: Wer ihre Adresse hat, liest Todo-Text, DID des Delegierten, `todoRef` und Status und
  kann so ein Todo mit seinem Treuhand-Vorgang on-chain verknüpfen.
- **OrbitDB, versiegelte Listen.** Eine private Liste, die seit #176 angelegt wurde, enthält
  Umschläge ([Versiegelte Listen](#versiegelte-listen-technisch)). Versiegelt sind jedes Feld eines
  Todos, `delegation` und `budget` (`todoRef`, Transaktions-Hashes, Status) eingeschlossen, der Name
  der Liste und die Umbenennung durch eine delegierte Person.

Nicht öffentlich: Beträge innerhalb des Tokens (gesperrt, freigegeben, zurückgezahlt, Guthaben) und ob
ein Transfer den angeforderten Betrag oder 0 bewegt hat.

In einer versiegelten Liste lesen der Relay und alle mit der Adresse der Liste ohne Schlüssel:

| Lesbar                                                                                        | Wo                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eintragsschlüssel und damit der Zeitpunkt, an dem ein Todo angelegt wurde                     | `key` jedes Eintrags (`todo_<Millisekunden>_…`); auch `op`, sodass eine Löschung sichtbar ist                                                                                                                                      |
| Wer jeden Eintrag geschrieben hat, und in welcher Reihenfolge                                 | `identity` des Eintrags und seine logische Uhr                                                                                                                                                                                     |
| Welche Todos jemandem übergeben sind, und wie oft ein Schlüssel wechselte                     | `scope` und `epoch` jedes Umschlags                                                                                                                                                                                                |
| Die Größe jedes Todos                                                                         | das Chiffrat; Umschläge werden nicht aufgefüllt                                                                                                                                                                                    |
| Die Aktionen einer delegierten Person: welches Todo, wer, wann, erledigt oder nicht, bis wann | Schlüssel `delegation-action/<todoKey>/<delegateDid>/…`; `taskKey`, `delegateDid`, `performedBy`, `performedAt`, `setCompleted`, `expiresAt`. Versiegelt ist nur `patch.text`: Den Rest prüft der Access Controller ohne Schlüssel |
| Wer schreiben darf                                                                            | die Schreibliste des Access Controllers (DIDs)                                                                                                                                                                                     |
| Wer eine Kopie welches Schlüssels hat, und damit, wem welches Todo übergeben wurde            | Slot-Namen in der Schlüsselablage: `list/<epoch>/<did>`, `task/<todoKey>/<epoch>/<did>`                                                                                                                                            |
| Die Anzahl der Einträge                                                                       | das Log                                                                                                                                                                                                                            |
| Die Identitätsdokumente der Signierer                                                         | öffentlich von Bauart: Jeder Eintrag nennt das seines Signierers                                                                                                                                                                   |
| Die Liste im Listenregister ihres Eigentümers: Adresse, Rolle, Anlagedatum                    | das Listenregister des Eigentümers, das der Relay hält und dessen Adresse nur der Eigentümer ableiten kann; der Name ist dort für den eigenen Schlüssel des Eigentümers versiegelt                                                 |
| Der öffentliche Schlüssel jeder Identität für versiegelte Listen                              | das Kontoverzeichnis, unter der DID                                                                                                                                                                                                |

`todoRef` ist SHA-256 über den Schlüssel des Todos und 32 Zufallsbytes (`createTodoRef` in
[`budget-service-zama.js`](../src/lib/budget/budget-service-zama.js)), der lesbare Eintragsschlüssel
führt also nicht zur Treuhand. Erraten lässt sich die Verknüpfung trotzdem: Die Schlüsselablage nennt
die DID einer delegierten Person neben dem Schlüssel des Todos, der den Zeitpunkt seiner Anlage
trägt; auf Sepolia ordnet das Kontoverzeichnis dieser DID ein Konto zu; und `Locked` nennt Ersteller
und Begünstigten, mit dem Zeitstempel seines Blocks.

## Vertrauensannahmen

### Vertrauen: einfach

Die Geheimhaltung der Beträge hängt davon ab, dass Zamas Schlüsselverwalter sich nicht absprechen;
Zamas Whitepaper toleriert Absprachen von bis zu 4 der 13. Ob sich Beträge überhaupt lesen lassen,
hängt davon ab, dass Zamas Relayer, Gateway und Schlüsselverwalter online sind. Die Regeln des gesamten Systems können von Zamas Protokoll-Governance geändert werden.

Versiegelte Listen verlangen für die Geheimhaltung kein Vertrauen über die Personen hinaus, mit denen
eine Liste geteilt ist. Der Relay behält sie, ohne sie zu lesen: Ihm wird vertraut, dass er da ist,
nicht, dass er ein Geheimnis wahrt.

### Vertrauen: technisch

| Partei                                                        | Konfiguration am 2026-09-16                                                                                                                                                                                                                                                                         | Wofür vertraut wird                                                                               | Fehlerfall                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KMS-Betreiber                                                 | 13 Signierer; Schwellenwerte in ProtocolConfig: Nutzer-Entschlüsselung 9, öffentliche Entschlüsselung 7, Schlüsselerzeugung 7, MPC 4 (Sepolia und Mainnet). Zamas Dokumentation: Knoten laufen standardmäßig in AWS Nitro Enclaves, Protokoll robust bei höchstens einem Drittel bösartiger Knoten. | Vertraulichkeit jedes Chiffrats unter dem globalen Schlüssel; korrekte Entschlüsselungsergebnisse | Zamas FHEVM-Whitepaper (Juni 2025) toleriert Kollusionen von bis zu 4 der 13 Betreiber, 5 oder mehr zusammenwirkende Betreiber liegen außerhalb dieser Zusage und könnten alles entschlüsseln (siehe [zama-confidential-transactions.de.md](zama-confidential-transactions.de.md#vertrauen-technisch)); sind zu wenige Betreiber online, stoppt jede Entschlüsselung |
| Coprozessoren                                                 | Input-Attestierungen: 3 von 5 Signierern auf Sepolia, 1 von 1 im Ethereum-Mainnet                                                                                                                                                                                                                   | nur wohlgeformte Inputs akzeptieren; korrekte FHE-Berechnung; Chiffrate speichern                 | laut Zamas Dokumentation sind Ergebnisse gültig, solange mehr als die Hälfte ehrlich ist; im Mainnet attestiert ein einziger Signierschlüssel jeden verschlüsselten Input                                                                                                                                                                                            |
| Gateway                                                       | Arbitrum-Rollup, Chain-ID 10901 (Testnetz)                                                                                                                                                                                                                                                          | Anfragen ordnen und weiterleiten, den KMS-Kontext festschreiben                                   | Stillstand: keine Input-Attestierung, keine Entschlüsselung                                                                                                                                                                                                                                                                                                          |
| Relayer                                                       | `relayer.testnet.zama.org`, kein Schlüssel; der gehostete Mainnet-Relayer verlangt einen API-Schlüssel; Self-Hosting ist dokumentiert                                                                                                                                                               | Verfügbarkeit                                                                                     | ausgefallen: Das SDK kann über ihn weder verschlüsseln noch entschlüsseln; der Zustand on-chain bleibt unberührt                                                                                                                                                                                                                                                     |
| Protocol DAO (Owner der ACL und über sie aller Host-Verträge) | Sepolia `0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, Mainnet `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`                                                                                                                                                                                          | die Regeln nicht ändern                                                                           | kann Upgrades von ACL, Executor und Verifiern durchführen, Signierer-Sets und Schwellenwerte von Coprozessoren und KMS, HCU-Limits und die Blockliste ändern                                                                                                                                                                                                         |
| Mitglieder von PauserSet                                      | keine Funktion listet sie auf; laut `AddPauser`-Events und `isPauser`: 1 auf Sepolia, 17 im Mainnet                                                                                                                                                                                                 | nicht pausieren                                                                                   | eine pausierte ACL weist `allow` und `allowTransient` zurück, sodass jede FHE-Operation revertiert; nur der Owner hebt die Pause auf                                                                                                                                                                                                                                 |
| Client-Code                                                   | `@zama-fhe/sdk` 3.6.0, `@fhevm/sdk` 0.13.2, WASM von npm                                                                                                                                                                                                                                            | ehrliche Schlüsselerzeugung, Proofs und Rekonstruktion                                            | eine kompromittierte Seite liest entschlüsselte Werte und den privaten Transportschlüssel                                                                                                                                                                                                                                                                            |

Kein Service Level Agreement für den Relayer, das Gateway oder das KMS von Sepolia wird in der hier
zitierten Dokumentation erwähnt. Die Vorfälle vom 2026-08-31 bis 2026-09-01 und vom 2026-09-03 ließen
die Nutzer-Entschlüsselung auf Sepolia fehlschlagen, während die Chain korrekt war (siehe
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md#vorfälle-technisch)).

Versiegelte Listen fügen dieser Tabelle keine Partei hinzu. Worauf sie beruhen:

- **Wer einen Schlüssel ausgeben darf.** Der Controller der Schlüsselablage lässt nur den Eigentümer
  schreiben (`IPFSAccessController({ write: [owner] })`), und OrbitDB weist jeden Eintrag zurück, den
  seine Identität nicht signiert hat. Die Verpackung selbst authentifiziert keinen Absender: Ihr
  Absenderschlüssel ist ephemer.
- **Für wessen Schlüssel eine Kopie verpackt wird.** Für den öffentlichen Schlüssel im
  Kontoverzeichnis der lesenden Person, in das nur deren DID schreiben kann. Niemand kann dem
  Eigentümer einen eigenen Schlüssel zum Verpacken unterschieben.
- **Identitätsdokumente, die über Gossipsub mitreisen**
  ([`identity-blocks.js`](../src/lib/identity-blocks.js)). Eine Antwort an einen Neuankömmling trägt
  die Identitätsdokumente der Schreibenden. Eine Sitzung legt jedes nur unter der CID seiner eigenen
  Bytes ab, beim Eintreffen berechnet, und OrbitDB prüft Identität und Eintrag wie zuvor. Sie fügen
  kein Vertrauen hinzu: Ein Bitswap-Abruf über diese CID hätte dieselben Bytes geliefert.
  Identitätsdokumente sind öffentlich.
- **Der Relay** hält Umschläge, verpackte Kopien und Metadaten. Ihm wird nur für die Verfügbarkeit
  vertraut.
- **Die Seite.** Eine Seite, die kompromittiert ist, während sie läuft, liest jede Liste, für die
  diese Sitzung einen Schlüssel hat.

## Der Token: cUSDTMock

### Token: einfach

Die Treuhand hält Zamas Test-Dollar-Token. Sein Owner, Zamas Protokoll-Governance, kann den Code des
Tokens ersetzen, Observer benennen, die alle Beträge im Token lesen dürfen, Adressen blockieren und
jemanden ernennen, der ihn pausieren darf. Am 2026-09-16 gab es keine Observer, und niemand war zum
Pausieren ernannt.

### Token: technisch

cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491` ist ein ERC-1967-Proxy auf `ConfidentialWrapper`
`0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04` (exakte Übereinstimmung auf Sourcify). Owner:
`0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, die Protocol DAO. Relevante Befugnisse im verifizierten
Quellcode:

- **Upgrade.** UUPS; `_authorizeUpgrade` ist `onlyOwner`. Die Mittel der Treuhand hängen davon ab,
  dass die Implementierung ein korrektes ERC-7984 bleibt. `renounceOwnership` ist deaktiviert.
- **Observer.** `addObserver(observer)` ist `onlyOwner` und ruft
  `FHE.delegateUserDecryptionWithoutExpiration(observer, WILDCARD_CONTRACT)` auf: Der Token delegiert
  seine eigenen Rechte zur Nutzer-Entschlüsselung an den Observer, für jeden Vertrag, ohne
  Ablaufzeitpunkt. Die ACL gewährt eine delegierte Entschlüsselung eines Handles, wenn der Delegierende
  (der Token) und der benannte Vertrag beide dauerhaft für das Handle berechtigt sind. Der Token behält
  eine dauerhafte Berechtigung für jeden Betrag, den er zurückgibt, und die Treuhand berechtigt sich
  selbst für das, was sie speichert; am 2026-09-16 waren `persistAllowed(amount, cUSDTMock)` und
  `persistAllowed(amount, escrow)` für den ersten gesperrten Betrag beide true. Ein Observer kann daher
  jeden Betrag entschlüsseln, den diese Treuhand speichert, ebenso jedes Guthaben und jeden Transfer im
  Token, was Zamas Wrapper-Dokumentation für Guthaben, Gesamtmenge und Transfers angibt. Observer sind
  öffentlich (`observers()`, Event `ObserverAdded`); `observers()` lieferte am 2026-09-16 eine leere
  Liste.
- **Blockliste.** `blockUser` ist `onlyOwner`; `_update` des Tokens prüft Absender und Empfänger
  sowie den Aufrufer, wenn er nicht der Absender ist. Die Treuhand ist bei allen drei ihrer Transfers
  Aufrufer oder Absender, eine blockierte Treuhand lässt also jedes `lock`, `release` und `refund`
  revertieren; ein blockierter Ersteller lässt `lock` und `refund` revertieren, ein blockierter
  Begünstigter `release`, solange die Blockierung besteht. Der Owner kann den Token außerdem die
  Blockliste des zugrunde liegenden Tokens abfragen lassen (`setUnderlyingDenyListSelector`); bei
  cUSDTMock war diese Prüfung am 2026-09-16 abgeschaltet (`0x00000000`). `isBlocked` war während des
  Laufs für die Treuhand, den Ersteller und den Begünstigten false.
- **Pause.** `pause()` darf nur von `pauser()` aufgerufen werden, den der Owner festlegt; `pauser()`
  lieferte am 2026-09-16 `address(0)`, also konnte niemand pausieren, ohne dass der Owner zuvor einen
  Pauser ernennt. Während der Pause revertiert jeder Transfer und damit jede Sperre, Freigabe und
  Rückzahlung.
- **Offenlegung durch einen Beteiligten.** `requestDiscloseEncryptedAmount(handle)` erlaubt jedem
  Konto, das für ein Handle berechtigt ist, es über den Token, der ebenfalls berechtigt ist, öffentlich
  entschlüsselbar zu machen. Der Ersteller, der Begünstigte und die Prüfstelle können auf diese Weise
  jeweils einen gesperrten Betrag veröffentlichen; ein Observer kann es nicht, weil eine Delegation
  keine ACL-Berechtigung ist.

## Die Prüfstelle

### Prüfstelle: einfach

Die Treuhand benennt eine Prüfstelle für immer. Die Prüfstelle kann jeden Betrag lesen, der jemals
darin gesperrt wurde. Derzeit ist die Prüfstelle das eigene Testkonto des Entwicklers, dessen
Schlüssel laut Runbook unverschlüsselt in einer Konfigurationsdatei auf einem Entwicklungsrechner
liegt.

### Prüfstelle: technisch

- `auditor` ist `immutable`, wird im Konstruktor gesetzt und ist ungleich null. Jedes `lock` ruft
  `FHE.allow(transferred, auditor)` auf. Die ACL hat keine Funktion, die eine dauerhafte Berechtigung
  entfernt, daher kann die Prüfstelle jeden in diesem Deployment gesperrten Betrag entschlüsseln,
  solange die Chiffrate existieren.
- Eine Rotation ist unmöglich. Eine neue Prüfstelle bedeutet eine neue Treuhand. Treuhand-Vorgänge im
  alten Vertrag bleiben dort, und die alte Prüfstelle liest ihre Beträge weiterhin.
- Die Prüfstelle im Deployment ist `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, der Deployer, der
  zugleich der Ersteller des Smoke-Tests ist. Dessen privater Schlüssel ist der `DEPLOYER_PRIVATE_KEY`
  des Sepolia-Runbooks, den das Runbook in `contracts/.env` ablegt: eine Klartextdatei, die von git
  ignoriert wird. Wer diesen Schlüssel erlangt, kann jeden gesperrten Betrag entschlüsseln, als
  Ersteller des Smoke-Tests sperren und freigeben und dessen Sepolia-ETH ausgeben.
- Die Prüfstelle ist für alle sichtbar: `auditor()` und das Event `Allowed` in jeder Sperre.
- Delegiertes Lesen für einen Prüfstellen-Dienst würde `ACL.delegateForUserDecryption` verwenden, das
  selbst öffentlich ist und die Prüfstelle mit ihrem Delegierten verknüpft.

## Input-Proofs und Wiederverwendung

### Wiederverwendung: einfach

Ein verschlüsselter Betrag wird nur von der Person angenommen, für die er erstellt wurde, und nur über
den Vertrag, für den er erstellt wurde. Ihn aus einer ausstehenden Transaktion zu kopieren, hilft
niemand anderem.

### Wiederverwendung: technisch

- Die Coprozessoren signieren `CiphertextVerification(bytes32[] ctHandles, address userAddress, address
contractAddress, uint256 contractChainId, bytes extraData)`. On-chain setzt FHEVMExecutor
  `contractAddress` auf seinen Aufrufer und übernimmt `userAddress` vom aufrufenden Vertrag; das ist
  der `msg.sender` der Treuhand. InputVerifier ermittelt die Signierer per ECDSA-Recovery und verlangt
  den Schwellenwert (3 von 5 auf Sepolia, 1 von 1 im Mainnet). Ein Proof, der von einem anderen Konto
  oder über einen anderen Vertrag verwendet wird, ergibt bei der Recovery einen Nicht-Signierer:
  `InvalidSigner`. Der clientseitige ZK-Proof ist über seine Metadaten zusätzlich an Vertrag, Nutzer,
  ACL und Chain-ID gebunden.
- Tests: "rejects an encrypted amount made for someone else" (ein anderes Konto verwendet den Input
  des Erstellers erneut) und "verifies the encrypted amount itself instead of forwarding it to the token"
  (Weiterleiten schlägt fehl; wird stattdessen für (Token, Treuhand) verschlüsselt, entsteht ein Proof,
  den jeder erneut verwenden kann).
- Es gibt keine Nonce. Derselbe Nutzer kann denselben Proof in einer späteren Transaktion über
  denselben Vertrag erneut einreichen und erhält dasselbe Handle: eine zweite Sperre desselben
  verschlüsselten Betrags. Das ist für die Mittel unschädlich, verknüpft die beiden Sperren aber
  öffentlich.
- Innerhalb einer Transaktion wird ein verifizierter Proof im transienten Speicher unter (Vertrag,
  Nutzer, Proof) zwischengespeichert. Transiente ACL-Berechtigungen gelten ebenfalls bis zum Ende der
  Transaktion; in einem Bündel von User Operations überdauern sie von einer Operation zur nächsten, es
  sei denn, jemand ruft `cleanTransientStorage()` auf, was jeder darf. Sie bleiben an das Konto
  gebunden, dem sie gewährt wurden.
- Mit leerem Proof nimmt die Treuhand ein bestehendes Handle nur an, wenn `ACL.isAllowed(handle,
msg.sender)` gilt; Test "takes an existing handle without a proof only from someone who may use it".

## Eigenschaften der Treuhand selbst

### Eigenschaften der Treuhand: einfach

Nur die Person, die das Geld gesperrt hat, kann es auszahlen oder zurücknehmen, und das Zurücknehmen
funktioniert erst nach der Frist. Jeder Treuhand-Vorgang kann einmal abgeschlossen werden. Die Treuhand
hat keinen Owner, der diese Regeln ändern könnte.

### Eigenschaften der Treuhand: technisch

Aus dem Quelltext des Vertrags und seinen 16 Hardhat-Tests in `contracts/test/ConfidentialTodoEscrow.ts`
(FHEVM-Mock):

- `release` und `refund` schlagen `_escrows[msg.sender][todoRef]` nach: konstruktionsbedingt nur für
  den Ersteller.
- `refund` verlangt `block.timestamp > deadline`; `lock` begrenzt die Frist auf 365 Tage.
- Einmalig: Eine zweite Freigabe, eine Freigabe nach einer Rückzahlung, eine Rückzahlung nach einer
  Freigabe und eine zweite Sperre unter derselben `todoRef` revertieren allesamt.
- Der Zustand wird geschrieben, bevor der Token aufgerufen wird (`lock`, `release`, `refund`).
- Events enthalten keine Beträge und keine Handles.
- Der Konstruktor lehnt einen Token ohne ERC-7984 in ERC-165 und eine Prüfstelle mit Nulladresse ab.
- Kein Owner, kein Upgrade, keine Gebühr, keine Funktion außer `release` und `refund`, die Mittel
  bewegt.

Beabsichtigt, kein Versehen:

- Der Begünstigte hat keinen On-Chain-Anspruch. Ein Ersteller kann eine Freigabe zurückhalten und nach
  der Frist zurückzahlen; die Treuhand schützt die Mittel des Erstellers, nicht die Arbeit des
  Begünstigten.
- Eine ungedeckte Sperre gelingt mit einer verschlüsselten 0. Der Begünstigte sollte den
  gesperrten Betrag vor Arbeitsbeginn entschlüsseln; die App soll ihn nach jeder Sperre entschlüsseln.
- Die Operator-Genehmigung (`setOperator`) hat keinen Betrag, nur einen Ablaufzeitpunkt. Die Treuhand
  zieht nur von ihrem eigenen Aufrufer ein, daher kann niemand sonst die Genehmigung über die Treuhand
  nutzen, sie sollte aber bald ablaufen.

## Grenzen

### Grenzen: einfach

Das läuft in einem Testnetz mit Testgeld und Testinfrastruktur, auf einer Protokollversion, die
demnächst abgelöst wird. Es ist eine Demonstration, kein Produkt.

### Grenzen: technisch

- **Protokoll v0.14.** Veröffentlicht am 2026-08-14, am 2026-09-16 weder auf Sepolia noch im Mainnet
  deployt. Es ändert die Nutzer-Entschlüsselung (vereinheitlichte Permits, `durationSeconds`,
  ERC-1271-Konten) und die Versionen der Host-Verträge. Die Treuhand ist mit `@fhevm/solidity` 0.11.1
  gegen Host-Verträge v0.13 kompiliert; ein Wechsel auf v0.14 erfordert eine Kompatibilitätsprüfung
  und kann ein neues Deployment nötig machen, was auch eine neue Entscheidung über die Prüfstelle und
  neue Treuhand-Vorgänge bedeuten würde
  ([Checkliste für ein erneutes Deployment](../contracts/README.md#redeploy-checklist)).
- **Zuverlässigkeit von Sepolia.** Zwei Entschlüsselungsvorfälle Anfang September 2026. Der Smoke-Test
  wiederholt Relayer-Aufrufe und wartet vor dem Entschlüsseln zwei Bestätigungen ab; einen Ausfall
  kann er nicht beheben.
- **Kein SLA** ist in den zitierten Quellen für die Testnetz-Dienste dokumentiert.
- **Test-Assets.** USDTMock kann von jedem gemintet werden (bis zu 1.000.000 Token pro Aufruf). Nichts
  hier hat einen Geldwert.
- **Das Mainnet unterscheidet sich.** Der InputVerifier des Mainnets hat einen einzigen
  Coprozessor-Signierer; der gehostete Relayer braucht einen API-Schlüssel und berechnet Gebühren;
  cUSDT im Mainnet ist ein anderer Vertrag. Nichts in diesem Kapitel wurde im Mainnet ausgeführt.
- **Mock gegenüber Sepolia.** Der Hardhat-Mock verwendet Host-Verträge 0.10.0: Eine Delegation muss
  mindestens eine Stunde in der Zukunft ablaufen und kann die Wildcard nicht verwenden, und HCU-Limits
  vergleichen mit `>=`, wo HCULimit auf Sepolia `>` verwendet.
- **Die App** hat keine Schaltfläche für die Rückzahlung. Ihr Sepolia-Dienst ordnet einer DID ein
  Konto über ein OrbitDB-Verzeichnis zu, in das nur diese DID schreiben kann, und prüft zusätzlich,
  dass der Passkey der DID dort Admin ist ([Kontozuordnung](passkey-account.de.md#kontozuordnung-technisch)).

## Passkey-Wallet

Seit dem 2026-09-17 eingebaut, hinter `VITE_BUDGET_SERVICE=zama`
([`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js),
[`src/lib/chain/`](../src/lib/chain)): Zamas Token und die Treuhand, signiert über ein Konto auf Calibur,
einem nicht änderbaren Smart Contract von Uniswap Labs
([Was Calibur ist](passkey-account.de.md#calibur-einfach)), das der Passkey kontrolliert. Wie das Schritt für Schritt abläuft, steht in
[passkey-account.de.md](passkey-account.de.md). Die folgenden Fakten betreffen Calibur v1.0.0
(Uniswap, Tag `v1.0.0`), Zama v0.13 und das, was die App damit macht.

### Passkey-Wallet: einfach

Ein Passkey auf dem Gerät kontrolliert das Konto, das das Geld hält. Zwei Eigenschaften des gewählten
Kontovertrags sind von Bedeutung: Der gewöhnliche Schlüssel, der das Konto erstellt hat, bleibt für
immer ein allmächtiger Generalschlüssel, und die Chain prüft nicht, ob die Person tatsächlich mit
Fingerabdruck oder Gesicht bestätigt hat. Zum Lesen von Beträgen braucht der Browser außerdem einen
zusätzlichen, temporären Schlüssel, weil Zamas aktuelle Version keine Signaturen solcher Konten
annehmen kann; die App hält ihn bis zu 24 Stunden und speichert ihn nur versiegelt, unter einem
Schlüssel, den der Passkey ableitet. Ein Konto, dessen Passkey verloren
ist, kann niemand wiederherstellen, und der Schlüssel, der das Gas bezahlt, ist in der Seite lesbar.
Bevor der Passkey signiert, prüft der Wallet-Code, was der Blockchain-Dienst verlangt: Kein Schritt
darf mehr als eine feste Grenze kosten, und die Schritte des Kontos laufen einer nach dem anderen.

### Passkey-Wallet: technisch

- **Der EOA-Setup-Schlüssel ist für immer Root.** Calibur ist ein Delegationsziel nach EIP-7702. Sein
  Root-Key ist der eigene secp256k1-Schlüssel des Kontos (`KeyLib.isRootKey`: ein
  `Secp256k1`-Schlüssel, dessen Adresse das Konto selbst ist; der Platzhalter-Schlüssel-Hash
  `bytes32(0)` steht für ihn). `register` und `update` weisen den Root-Key zurück, `revoke` kann ihn
  nicht entfernen, weil er nie in der Schlüsselmenge liegt, und `_isOwnerOrValidKey` akzeptiert ihn
  immer. `isValidSignature` akzeptiert von ihm jede rohe, 64 oder 65 Byte lange ECDSA-Signatur.
  Calibur hat keine Funktion, die ihn abschaltet. Unabhängig von Calibur kann dieser Schlüssel unter
  EIP-7702 weiterhin Transaktionen senden und neue Delegationszuweisungen signieren, er behält die
  Kontrolle über das Konto also auch bei einer geänderten Delegation. Das Löschen des
  Setup-Schlüssels nach dem Onboarding ist der einzige Schutz, und es lässt sich on-chain nicht
  nachweisen. Die App erzeugt ihn im Arbeitsspeicher, nutzt ihn für eine gesponserte UserOperation
  und verwirft jeden Verweis, sobald der Passkey eingetragen ist (`discard()`); das Konto hält nichts,
  bis der Passkey die erste Sperre signiert.
- **Nutzerverifikation (UV) wird on-chain nicht erzwungen.** `KeyLib.verify` prüft
  `WebAuthnP256`-Schlüssel mit `WebAuthn.verify({ ..., requireUV: false, ... })`. Ob der Authenticator
  den Nutzer verifiziert hat (PIN, Biometrie), erzwingt nur der Client-Code, der die Assertion
  anfordert; die App fordert `userVerification: 'required'` an. Die eingebundene Bibliothek
  webauthn-sol verlangt das Flag für Nutzerpräsenz (UP) und prüft on-chain weder den Origin noch den
  `rpIdHash`.
- **Andere Schlüssel als der Root-Key signieren ERC-1271-Nachrichten nur in ERC-7739-Form.** Caliburs
  `isValidSignature` leitet rohe Signaturen an den Root-Key weiter und erwartet für jeden anderen
  Schlüssel den ERC-7739-Ablauf TypedDataSign oder NestedPersonalSign; auch der Root-Key kann diesen
  Ablauf nutzen.
- **Zama v0.13 akzeptiert nur ECDSA-Permits.** `@fhevm/sdk` 0.13.2 verlangt 65 Byte lange Signaturen
  und vergleicht die per Recovery ermittelte Adresse; der `Decryption`-Vertrag des Gateways revertiert
  mit `InvalidUserSignature`, es sei denn, der ECDSA-Signierer ist der Nutzer. Ein Passkey-Konto kann
  kein Entschlüsselungs-Permit signieren. Der Workaround der App ist ein secp256k1-Sitzungsschlüssel,
  der Leseschlüssel, den das Konto mit `ACL.delegateForUserDecryption(sessionKey, contract, expiry)`
  autorisiert, einmal pro Vertrag (Token und Treuhand), für 24 Stunden: im Stapel der Einrichtung und
  bei jeder Erneuerung mit einem neuen Schlüssel. Der Schlüssel liegt versiegelt (AES-GCM unter einem
  Schlüssel, den HKDF aus dem PRF-Wert des Passkeys ableitet), mit „In diesem Browser behalten“ in
  `localStorage` des Browsers und ohne es im Arbeitsspeicher des Tabs, und wird einmal pro Besuch im
  Speicher geöffnet; eine Seite, die währenddessen kompromittiert ist, kann ihn
  benutzen ([Der Leseschlüssel](passkey-account.de.md#leseschlüssel-technisch)). Dieser PRF-Abruf
  ist eine eigene Berührung; der eine PRF-Abruf jedes Starts liefert den OrbitDB-Signaturschlüssel
  und den Schlüssel für versiegelte Listen ([Versiegelte Listen](#versiegelte-listen-technisch)). Das Event `DelegatedForUserDecryption` macht die Verknüpfung zwischen Konto und
  Sitzungsschlüssel öffentlich, und der Sitzungsschlüssel kann bis zum Ablauf oder zu einem Widerruf
  alles lesen, was das Konto in diesen Verträgen lesen darf.
- **v0.14** ergänzt für seine neue, vereinheitlichte Anfrage eine ERC-1271-Verifikation im
  KMS-Connector (`ecrecover` bei einer 65 Byte langen Signatur, andernfalls ein gasbegrenzter Aufruf
  von `isValidSignature`). Auf einem Sepolia-Fork hat am 2026-10-12 die eigene ERC-1271-Vorprüfung von
  `@fhevm/sdk` 0.14.3 ein solches Permit angenommen, vom Passkey-Konto in ERC-7739-Form signiert
  ([keys.de.md](keys.de.md#vorab-geprüft-ohne-zama-am-2026-10-12)). Ob Zamas KMS es annimmt, bleibt
  offen, bis v0.14 auf Sepolia läuft.
- **Sponsoring.** Der publishable Openfort-Schlüssel ist Teil der Seite. Die Openfort-Regel dahinter,
  `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, nimmt `sponsorEvmTransaction` auf Chain 11155111 an, ohne
  Einschränkung auf Verträge oder Funktionen. Wer den Schlüssel aus der Seite liest, kann beliebige
  UserOperations auf Sepolia sponsern lassen, bis das Guthaben des Projekts aufgebraucht ist; für ein
  Konto signieren kann der Schlüssel nicht. Einen geheimen `sk_`-Schlüssel in der Konfiguration lehnt
  die App ab (`readChainEndpoints`).
- **Was das Konto nicht signiert (Wallet 0.3.0).** Bundler, Paymaster und RPC gehören Openfort und
  öffentlichen Knoten, und bis Wallet 0.2.0 signierte der Passkey die Gaswerte, Gebühren und den
  Nonce-Schlüssel, die sie wählten (GHSA-fv6j-cmpw-5vf7). Seit 0.3.0 wird jede UserOperation geprüft,
  bevor ein Schlüssel gefragt wird: Auf Chain 11155111 bleibt jedes Gasfeld unter einer Obergrenze
  (preVerificationGas 250.000), Gaslimits × `maxFeePerGas` bleiben unter `MAX_USER_OPERATION_COST`,
  0,02 ETH, und die Nonce liegt auf Schlüssel 0. Die Einrichtung, die der Setup-Schlüssel signiert,
  darf bis zu 500.000 preVerificationGas tragen: Openfort setzte 317.856 bei den Einrichtungen vom
  2026-11-25. Auf einem Nonce-Schlüssel laufen die Operationen eines Kontos nacheinander, darum sendet
  die App sie eine nach der anderen (`oneAtATime` in
  [`sepolia-chain.js`](../src/lib/chain/sepolia-chain.js)); gesendet, während die erste noch offen
  ist, bekäme eine zweite deren Nonce und ersetzte sie oder würde abgelehnt. Eine Ablehnung erscheint
  in der Seite als „Es wurde nichts signiert und nichts gesendet“, und der Passkey wird nicht gefragt.
  Die Zahlen stammen aus allen 52 UserOperations, die escrow01 vom 2026-09-17 bis 2026-11-25 auf
  Sepolia gesendet hat ([`config.js`](../src/lib/chain/config.js)).
- **Keine Wiederherstellung ohne den Passkey.** Außer dem verworfenen Root-Key ist der Passkey der
  einzige Schlüssel des Kontos. Ein synchronisierter Passkey erreicht weitere Geräte und gibt dort
  seit Provider 0.8.0 Identität und Konto zurück, ohne gespeicherte Daten, seit #176 in vier
  Berührungen (in dreien, sobald Provider #107 veröffentlicht ist;
  [wie oft der Passkey fragt](passkey-account.de.md#wie-oft-der-passkey-fragt)). Ein verlorener
  nimmt das Konto mit, und jede Kopie eines Listenschlüssels, die für ihn versiegelt ist.
- **Calibur v1.1.0.** Uniswap hat am 2026-07-02 v1.1.0 unter einer neuen Adresse veröffentlicht und
  führt seitdem nur diese Version. Unter anderem dürfen dort nur Admin-Schlüssel den EntryPoint
  aufrufen. Die App nutzt v1.0.0, in der ihr einziger Schlüssel außer dem Root-Key ein Admin ist
  ([Was Calibur ist](passkey-account.de.md#calibur-technisch)).

## Versiegelte Listen

Seit #176 (Issue #127) wird eine private Liste im Browser versiegelt, bevor etwas ihn verlässt
([`src/lib/sealed/`](../src/lib/sealed)). Die geteilte Liste hinter drei spanischen Wörtern und
private Listen von vor #176 bleiben, wie sie waren. Wie die Schlüssel mit dem Passkey
zusammenhängen, steht in [keys.de.md](keys.de.md#schlüssel-technisch), wie oft der Passkey fragt, in
[passkey-account.de.md](passkey-account.de.md#wie-oft-der-passkey-fragt), und was lesbar bleibt,
unter [Was sichtbar wird](#was-sichtbar-wird-technisch).

### Versiegelte Listen: einfach

Jedes Todo einer privaten Liste wird verschlossen, bevor es den Browser verlässt. Der Eigentümer hat
den Schlüssel, ebenso alle, denen er das Schreiben erlaubt. Wem er ein einzelnes Todo übergibt, der
bekommt einen Schlüssel nur für dieses Todo. Der Relay behält die Liste, ohne sie lesen zu können,
und ebenso alle anderen, die ihre Adresse haben.

Wird eine schreibberechtigte Person entfernt, bekommen alle anderen neue Schlüssel, und was danach
geschrieben wird, bleibt ihr verschlossen. Was sie bis dahin lesen konnte, behält sie. Dasselbe gilt
für eine delegierte Person, der ihr Todo wieder entzogen wurde.

Die Schlüssel kommen bei jedem Start aus dem Passkey und werden nie gespeichert. Ein Passkey ohne die
PRF-Erweiterung bekommt einen Schlüssel, den es nur in diesem Browser gibt: Listen, die für ihn
versiegelt sind, öffnen sich nirgends sonst, und ohne „In diesem Browser behalten“ schließen sie sich
mit dem Tab.

### Versiegelte Listen: technisch

Wer was liest:

| Wer                                 | Liest                                                                                                                                        | Liest nicht                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eigentümer                          | jedes Todo, den Namen der Liste, jede Umbenennung durch eine delegierte Person                                                               |                                                                                                                                                                                              |
| Schreibberechtigte Person           | ab der Freigabe jede Epoche jedes Schlüssels, den der Eigentümer hat (`grant`): auch frühere Todos, delegierte eingeschlossen, und den Namen | nach dem Entfernen siehe die Zeile darunter                                                                                                                                                  |
| Delegierte Person                   | das ihr übergebene Todo, so wie es ab dieser Delegation geschrieben wird, und ihre eigenen Umbenennungen                                     | den Rest der Liste; den Namen; was vor der Delegation kam, denn jede Delegation ist eine neue Epoche des Todo-Schlüssels; das Todo, sobald es entzogen ist, denn es kommt wieder unter `K_L` |
| Entfernte schreibberechtigte Person | was sie bis zum Entfernen lesen konnte                                                                                                       | was unter einer späteren Epoche des Listenschlüssels oder des Schlüssels eines delegierten Todos versiegelt ist (`keysAfterWriterLeft`)                                                      |
| Fremde Person mit der Adresse       | die Metadaten unter [Was sichtbar wird](#was-sichtbar-wird-technisch)                                                                        | ein Todo, den Namen, eine Umbenennung                                                                                                                                                        |
| Relay                               | dasselbe wie eine fremde Person; er hält Umschläge und verpackte Kopien                                                                      | dasselbe wie eine fremde Person                                                                                                                                                              |

So funktioniert es:

- **Umschläge.** Der Wert eines Todos wird zu `{ sealed: 1, scope, epoch, nonce, ct }`: AES-GCM-256
  über WebCrypto mit einer frischen 12-Byte-Nonce und Associated Data, die Scope, Epoche und
  Eintragsschlüssel binden ([`sealed/envelope.js`](../src/lib/sealed/envelope.js)). Ein versiegeltes
  Todo öffnet sich daher nicht unter einem anderen Eintragsschlüssel oder Scope. Versiegelt wird in
  der App, nicht in OrbitDBs `encryption.data`: `@orbitdb/core` 4.0.0 wirft bei einem Payload, den es
  nicht entschlüsseln kann, und wem ein Schlüssel fehlt, dem ginge die Historie hinter diesem Eintrag
  verloren. OrbitDB sieht nie einen Schlüssel. Einen Umschlag, den diese Sitzung nicht öffnen kann,
  blendet sie aus und zählt ihn; nichts wirft.
- **Schlüssel.** `K_L` sind 32 Zufallsbytes pro Liste und Epoche, `K_T` dasselbe pro delegiertem
  Todo und Epoche ([`sealed/key-ring.js`](../src/lib/sealed/key-ring.js)). Neue Einträge kommen unter
  die höchste Epoche, die eine Sitzung hat. Die Schlüssel liegen nur im Arbeitsspeicher des Tabs.
- **Kopien.** Jede Kopie eines Schlüssels wird für eine lesende Person verpackt: ein ephemeres
  X25519-Schlüsselpaar, ECDH mit dem öffentlichen Schlüssel der Person, HKDF-SHA-256, dessen Info
  beide öffentlichen Schlüssel nennt, AES-GCM-256 mit dem Slot der Kopie als Associated Data
  ([`sealed/key-agreement.js`](../src/lib/sealed/key-agreement.js)). Eine Kopie, die in einen anderen
  Slot oder zu einer anderen Person verschoben wird, öffnet sich nicht.
- **Die Schlüsselablage.** Ein `keyvalue` pro Liste, in das nur der Eigentümer schreibt
  ([`sealed/key-store.js`](../src/lib/sealed/key-store.js)), sodass niemand einen Schlüssel
  unterschieben kann (#120). Die Slots heißen `list/<epoch>/<did>` und `task/<todoKey>/<epoch>/<did>`.
  Ihr Name folgt aus der Adresse der Liste; wer die Adresse hat, findet sie also. Der Eigentümer
  verpackt auch für sich selbst eine Kopie. In einer versiegelten Liste delegiert nur der Eigentümer,
  weil nur er in die Ablage schreibt.
- **Epochen** ([`sealed/list-keys.js`](../src/lib/sealed/list-keys.js),
  [`sealed/list-session.js`](../src/lib/sealed/list-session.js)). Eine Freigabe gibt einer
  schreibberechtigten Person jede Epoche jedes Schlüssels. Jede Delegation beginnt eine neue Epoche
  des Schlüssels dieses Todos, für den Eigentümer, die Schreibberechtigten und die delegierte Person.
  Ein entzogenes Todo bekommt keinen neuen Schlüssel: Es kommt wieder unter `K_L`, den die delegierte
  Person nie hatte. Das Entfernen einer schreibberechtigten Person beginnt eine neue Epoche des
  Listenschlüssels und des Schlüssels jedes delegierten Todos, für alle außer ihr.
- **Am Namen erkannt.** Der Datenbankname einer versiegelten Liste ist `sealed-v1-` und 32 zufällige
  Hex-Zeichen ([`sealed/sealed-list.js`](../src/lib/sealed/sealed-list.js)). Jeder Peer weiß, dass
  eine Liste versiegelt ist, bevor ein Eintrag ankommt; niemand schreibt also ein Todo im Klartext
  hinein, weil ein Schlüssel spät kommt. Eine Sitzung ohne Kopie wartet auf eine; sie macht nie einen
  eigenen Schlüssel.
- **Der Name der Liste** ist unter `K_L` in der Schlüsselablage versiegelt (`meta/name`), nicht in der
  Liste. Im Listenregister lässt eine versiegelte Liste `name` leer und trägt den Namen, versiegelt
  für den eigenen X25519-Schlüssel des Eigentümers und an die Adresse der Liste gebunden
  ([`sealed/registry-names.js`](../src/lib/sealed/registry-names.js)). Adressen, Rollen und Daten im
  Register bleiben lesbar.
- **Der persönliche Schlüssel** ist `deriveSubkey(prf, 'simple-todo/escrow01/list-key-agreement/v1')`:
  HKDF-SHA-256 über den PRF-Wert des Passkeys, importiert als privater X25519-Schlüssel, der sich
  nicht exportieren lässt. Derselbe Passkey ergibt auf jedem Gerät denselben Schlüssel. Seine
  öffentliche Hälfte steht im Kontoverzeichnis unter der DID, in das nur diese DID schreibt. Dieser
  Eintrag wird in jedem Build veröffentlicht, nicht nur auf Sepolia
  ([`chain/account-directory.js`](../src/lib/chain/account-directory.js)).
- **Ohne PRF**, und für eine Identität ohne Passkey, ist der Schlüssel zufällig und wird als nicht
  exportierbar erzeugt: mit „In diesem Browser behalten“ in IndexedDB, ohne es im Arbeitsspeicher des
  Tabs ([`sealed/own-agreement-key.js`](../src/lib/sealed/own-agreement-key.js)). Listen, die für ihn
  versiegelt sind, öffnen sich nur in diesem Browser; ohne „In diesem Browser behalten“ schließen sie
  sich mit dem Tab.
- **Nichts, was der Passkey ableiten kann, wird gespeichert.** Jeder Start mit Passkey liest PRF
  einmal ([`sealed/start-prf.js`](../src/lib/sealed/start-prf.js)). Der OrbitDB-Signaturschlüssel wird
  daraus in einen Keystore im Arbeitsspeicher abgeleitet, in beiden Speichermodi
  ([keys.de.md](keys.de.md#schlüssel-technisch)), und der X25519-Schlüssel aus demselben Wert, für den
  Tab gehalten. Der Wert selbst bleibt im Arbeitsspeicher des Tabs, je Credential, damit ein Neustart
  im selben Tab nicht noch einmal fragt. Den unverschlüsselten Keystore, den ein früherer Build in
  IndexedDB hielt, löscht der nächste Start, soweit möglich
  ([`kept-signing-keys.js`](../src/lib/kept-signing-keys.js)).
- **Zustellung.** Der Browser des Eigentümers antwortet jedem Neuankömmling an einer Schlüsselablage
  über Gossipsub mit den Identitätsdokumenten der Schreibenden und, bei einem kleinen Log, mit jedem
  Eintrag; eine Sitzung ohne Schlüssel fragt erneut ([`newcomers.js`](../src/lib/newcomers.js)). Das
  stellt nur zu. Warum es kein Vertrauen hinzufügt, steht unter
  [Vertrauensannahmen](#vertrauen-technisch).

Grenzen:

- Eine entfernte schreibberechtigte Person behält, was sie bis dahin lesen konnte: Das Log wird nur
  fortgeschrieben und nicht neu verschlüsselt. Eine Sitzung, die die neue Epoche noch nicht erhalten
  hat, versiegelt unter der höchsten, die sie hat, und die hat auch die entfernte Person. Dass der
  nächste Listenschlüssel sie nicht erreicht, prüft ein Unit-Test (`list-keys.spec.js`); die
  End-to-End-Prüfung ist `test.fixme`, wegen eines Zustellungsfehlers, der älter ist als #176.
- Eine delegierte Person behält die Fassungen ihres Todos, die geschrieben wurden, solange es ihres
  war.
- Zwei Geräte eines Eigentümers gleichzeitig: siehe [Offene Punkte](#offene-punkte), Punkt 10.

Tests: `src/lib/sealed/*.spec.js` und [`e2e/sealed-lists.spec.js`](../e2e/sealed-lists.spec.js) mit
Eigentümer, delegierter, schreibberechtigter und fremder Person, einschließlich der Prüfung, dass die
Kopie des Logs bei der fremden Person keinen Todo-Text im Klartext enthält.

## Offene Punkte

1. Prüfstelle: Die Prüfstelle im Deployment ist ein Entwicklungsschlüssel in einer Klartextdatei. Die
   echte Prüfstelle und die Verwahrung ihres Schlüssels sind zu wählen, bevor man sich auf ein
   Deployment verlässt; eine Änderung erfordert eine neue Treuhand.
2. Token-Governance: Observer, Upgrade, Blockliste und Pause von cUSDTMock liegen bei der Protocol DAO.
   Laut Zamas Wrapper-Dokumentation soll die Owner-Rolle des Wrappers an den Owner des zugrunde
   liegenden Tokens übergehen. Am 2026-09-16 gehörte cUSDT im Mainnet
   (`0xAe0207C757Aa2B4019Ad96edD0092ddc63EF0c50`) noch der Protocol DAO
   (`0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`), hatte keine Observer und keinen Pauser und fragte als
   Blockliste des zugrunde liegenden Tokens die Blacklist von USDT ab (`getBlackListStatus`).
3. Metadaten: Die Liste hinter drei Wörtern ist vollständig lesbar, und eine private Liste von vor
   #176 zeigt `todoRef`, DID des Delegierten und Budget-Status. Eine versiegelte Liste hält diese
   versiegelt, aber ihre Eintragsschlüssel, Signierer, die Aktionsfelder einer delegierten Person, die
   Schreibliste und die Slot-Namen der Schlüsselablage bleiben lesbar, und mit ihnen, wem welches
   Todo übergeben wurde ([Was sichtbar wird](#was-sichtbar-wird-technisch)).
   Entschlüsselungsanfragen sind auf der Gateway-Chain öffentlich.
4. Die App hat keine Schaltfläche für die Rückzahlung.
5. Passkey-Wallet: dauerhafter Root-Key, keine Nutzerverifikation on-chain, öffentliche Verknüpfung
   zwischen Konto und Sitzungsschlüssel, ein geöffneter Sitzungsschlüssel im Speicher der Seite für den Besuch, keine
   Wiederherstellung bei verlorenem Passkey, Calibur v1.0.0 statt v1.1.0.
6. Mainnet-Reife: ein einziger Coprozessor-Signierer für die Input-Attestierung im Mainnet,
   API-Schlüssel und Gebühren des Relayers, Migration auf v0.14, kein Audit.
7. Verfügbarkeit der Entschlüsselung: Die Anteils-Einstellungen des Relayers nach #3481 auf Sepolia
   sind unbekannt; es gibt kein dokumentiertes SLA.
8. Kein Audit der Treuhand; die Tests laufen gegen einen Mock, dessen Host-Verträge älter sind als die
   von Sepolia.
9. Sponsoring: Die Openfort-Regel sponsert jede UserOperation auf Sepolia für jeden, der den
   publishable Schlüssel der Seite hat; sie gehört auf die Verträge der Demo beschränkt und gedeckelt.
10. Versiegelte Listen: Zwei Geräte eines Eigentümers, die im selben Moment ein Todo übergeben oder
    eine schreibberechtigte Person entfernen, können jeweils einen Schlüssel für dieselbe Epoche
    erzeugen. Die Schlüsselablage behält eine Kopie pro Slot, ein Schlüsselring weist einen zweiten
    Schlüssel für eine Epoche ab, die er schon hat, und nichts löst den Konflikt auf: Was ein Gerät
    versiegelt hat, kann für Lesende, die den anderen Schlüssel haben, verschlossen bleiben.

## Quellen

Repository (`apps/escrow01`, Zeilennummern vom 2026-10-02):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): Prüfstelle
  49-52, Konstruktor 71-78, `lock` 100-136 (allow an die Prüfstelle 132), `release` 143-148, `refund`
  150-158.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts): 16 Tests,
  insbesondere 363-377, 379-419, 421-444.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt", "What stays public", "`.env`",
  "Before relying on a deployment".
- [`src/lib/budget/budget-service.js`](../src/lib/budget/budget-service.js) 1-18,
  [`src/lib/budget/budget.js`](../src/lib/budget/budget.js) 1-16, [`src/lib/i18n/en.json`](../src/lib/i18n/en.json)
  (`budget.notice.insufficient`).
- [`src/lib/budget/budget-service-zama.js`](../src/lib/budget/budget-service-zama.js) (`ensureAccount`, `accountOf`,
  `renewReadKey`), [`src/lib/chain/sepolia-chain.js`](../src/lib/chain/sepolia-chain.js)
  (`createAccount`, `isPasskeyAccount`), [`src/lib/chain/config.js`](../src/lib/chain/config.js)
  (`readChainEndpoints`), [`src/lib/chain/account-store.js`](../src/lib/chain/account-store.js); die
  Passkey-Wallet mit ihren Belegen in [passkey-account.de.md](passkey-account.de.md#quellen).
  Openfort-Regel `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, am 2026-09-17 über die Openfort-CLI
  gelesen.
- Versiegelte Listen, Stand 2026-11-27 (#176, Merge `83bb2e7`): [`src/lib/sealed/`](../src/lib/sealed)
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

cUSDTMock-Implementierung auf Sourcify
(<https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>):
`contracts/ConfidentialWrapper.sol` `WILDCARD_CONTRACT` 112, `blockUser` 229-231, `addObserver`
306-308, `observers` 336-338, `pauser` und `pause` 343-357, `renounceOwnership` 373-375,
`_addObserver` 391-403, `_requireNotBlocked` 420-425, `_update` 432-442, `_authorizeUpgrade` 497;
`contracts/token/ERC7984Upgradeable.sol` `requestDiscloseEncryptedAmount` 265-273, `_update` 343-378.

zama-ai/fhevm v0.13.5: `host-contracts/contracts/ACL.sol` (`allow` 206-216, `allowTransient` 253-272,
`delegateForUserDecryption` 283-334, `pause` 378-383, `isHandleDelegatedForUserDecryption` 478-491,
`cleanTransientStorage` 552-567, `_authorizeUpgrade` 591), `host-contracts/contracts/InputVerifier.sol`
(`verifyInput` 244-330, Recovery nur per ECDSA 517-525), `host-contracts/contracts/ACLEvents.sol`
(`DelegatedForUserDecryption`), `gateway-contracts/contracts/Decryption.sol` (`userDecryptionRequest`
441-526, `InvalidUserSignature` 916-927), `gateway-contracts/contracts/interfaces/IDecryption.sol`
(`UserDecryptionRequest` 96-102, `UserDecryptionResponse` 112-118),
`gateway-contracts/contracts/shared/Structs.sol` (`SnsCiphertextMaterial` 72-77). Pull Requests
[#2393](https://github.com/zama-ai/fhevm/pull/2393) (ERC-1271 im KMS-Connector) und
[#3481](https://github.com/zama-ai/fhevm/pull/3481).

`@fhevm/sdk` 0.13.2: `core/utils-p/runtime/recoverSigners.ts` 23,
`core/utils-p/decrypt/verifyKmsUserDecryptEip712V1.ts` 36-42, `core/modules/decrypt/module/api-p.ts`
236-242.

Calibur v1.0.0 (<https://github.com/Uniswap/calibur/tree/v1.0.0>): `src/libraries/KeyLib.sol` 26,
35-42, 58-77; `src/KeyManagement.sol` 21-46, 84-89; `src/Calibur.sol` 132-174. webauthn-sol im von
Calibur v1.0.0 eingebundenen Commit (`619f20ab0f074fef41066ee4ab24849a913263b2`): `src/WebAuthn.sol`
77-88 (Origin und `rpIdHash` ungeprüft), 133 (Nutzerpräsenz), 139 (Nutzerverifikation nur auf
Verlangen). EIP-7702: <https://eips.ethereum.org/EIPS/eip-7702>. Calibur v1.1.0: Release vom
2026-07-02 und <https://github.com/Uniswap/calibur/compare/v1.0.0...v1.1.0> (`src/Calibur.sol`,
`_process`).

Chain, gelesen am 2026-09-16: cUSDTMock `owner()`, `observers()`, `pauser()`,
`getUnderlyingDenyListSelector()`, Implementierungs-Slot; cUSDT im Mainnet `owner()`, `observers()`,
`pauser()`, `underlying()`, `getUnderlyingDenyListSelector()`; ACL `owner()`, `persistAllowed` für den
gespeicherten Betrag; Schwellenwerte von InputVerifier, KMSVerifier und ProtocolConfig auf Sepolia und
im Mainnet; `AddPauser`-Events (Blockscout) und `isPauser` des PauserSet auf Sepolia
(`0xc62392B4100a1bD45AbDBf91E70f1E4349402b46`) und im Mainnet
(`0xbBfE1680b4a63ED05f7F80CE330BED7C992A586C`).

Zamas FHEVM-Whitepaper, Version 3.1 vom 30. Juni 2025
(<https://github.com/zama-ai/fhevm/blob/main/fhevm-whitepaper.pdf>): Kollusionsschranke des KMS, S. 12.

Zama-Dokumentation: vertraulicher Wrapper, Observer
(<https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>); KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>); Coprozessor
(<https://docs.zama.org/protocol/protocol/overview/coprocessor>); Sicherheitsmodell des SDK
(<https://docs.zama.org/protocol/sdk/concepts/security-model>); API-Schlüssel des Relayers
(<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>); Adressen für Sepolia und Ethereum
(<https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia>,
<https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum>); Chains und Gateway-Explorer
(<https://docs.zama.org/protocol/protocol-apps/chains>).
