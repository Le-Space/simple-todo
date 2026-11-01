# Versiegelte Listen und ein zweiter Passkey

[English](./vault.md)

Eine Liste enthält Rechnungen und Kundenadressen, und OrbitDB kennt kein
Leserecht: Wer die Adresse einer Liste hat und einen Peer erreicht, der sie
hält, liest alles darin, das Relay eingeschlossen. **Versiegeln**, beim Anlegen
einer Liste angehakt, ändert das für diese eine Liste. Ihre Einträge werden
versiegelt, bevor sie den Browser verlassen, und was das Relay und jede andere
Kopie behalten, sind Bytes, die sie nicht lesen können.

## Wer eine versiegelte Liste liest

Die Passkeys dieser Listen, sonst niemand. Das schließt die Leute ein, um die
es in diesem Kapitel sonst geht: Eine DID mit Schreibrechten kann weiter
schreiben, aber nicht lesen, was schon dasteht, und wem ein Todo übergeben
wurde, der sieht es nicht. Deshalb ist Versiegeln eine Wahl und ohne Häkchen
aus. Eine Liste für Rechnungen ist versiegelt, eine Liste, die man mit Bob
teilt, nicht.

Listen von vorher bleiben, wie sie waren. Ein Eintrag, der geschrieben wurde,
bevor eine Liste versiegelt war, bleibt lesbar, weil die Entschlüsselung ihn
durchreicht (`entry-encryption.js`). Eine Liste wird aber nie nachträglich
versiegelt; der Fall kommt nur bei Listen vor, die anderswo versiegelt wurden.

Versiegelt ist jeder Eintrag der Liste: Todos, Rechnungen, Kunden und
Einstellungen gleichermaßen. Nicht versiegelt sind:

- der Access-Controller der Liste, der sagt, wer schreiben darf;
- die Signaturen der Einträge und die Identität, die jeden geschrieben hat;
- das Register Ihrer Listen, dessen Namen niemand aus Ihrer DID ableiten kann
  (siehe `list-registry.js`).

## Der Tresor

Der Schlüssel kommt aus dem Passkey, über einen Tresor (`src/lib/list-vault.js`).
Der Tresor hält eine Wurzel, versiegelt unter einem zufälligen Tresorschlüssel.
Jeder Passkey dieser Listen hat ein Fach: den Tresorschlüssel, versiegelt unter
einem Schlüssel, den nur dieser Passkey aus seiner PRF-Ausgabe ableitet. Jedes
Fach öffnet den Tresor, und heraus kommt dieselbe Wurzel. Aus ihr wird der
Listenschlüssel abgeleitet (`simple-todo/invoice01/list-key/v1`); jede
versiegelte Liste öffnet sich also für jeden Passkey mit Fach, und eine neue
Liste bringt nichts, das übergeben werden müsste.

Es ist der Tresor aus Le-Space/belege. `createVaultKeeper` aus dem Provider
(0.12.2) verwaltet ihn, im Format von Belege, unter
`simpleTodo.invoice01.vaults.v1` im Speicher dieses Origins, neben den Listen.
Der Datensatz ist öffentliches JSON: Namen, Credential-IDs und Datumsangaben,
und alles, worauf es ankommt, ist versiegelt.

Wie in Belege ist **die Wurzel die PRF-Ausgabe des Passkeys, der den Tresor
angelegt hat**, unverändert. Dieser Passkey braucht deshalb keinen Tresor, um an
seine eigenen Listen zu kommen. Auf einem Gerät, das ihn nie gesehen hat, legt
die erste versiegelte Liste einen neuen Tresor mit derselben Wurzel an, und
jeder Schlüssel kommt heraus wie vorher. Sein Listenregister bleibt, wo es immer
war, unter einem Namen, der aus seiner Signatur abgeleitet ist.

Der Tresor trägt außerdem die Adresse dieses Registers. Ein zweiter Passkey hat
eine andere Identität und könnte den Namen nie ableiten; über die Adresse im
Tresor findet er die Listen.

## Ein zweiter Passkey

Unter _Listen → Passkeys dieser Listen_ gibt der Passkey, mit dem Sie gestartet
sind, einem weiteren ein Fach. Das ist der Ersatzschlüssel in der Schublade. Er
wird an Ort und Stelle angelegt und einmal abgefragt. Der Browser arbeitet mit
dem Passkey weiter, mit dem er gestartet ist. Das Feld zeigt die DID des neuen
Passkeys, damit er auf den Listen, in die er schreiben soll, Schreibrechte
bekommen kann.

Um ihn zu verwenden, starten Sie mit _Vorhandenen Passkey verwenden_ und haken
_Einen anderen Passkey dieser Listen verwenden_ an. Dann wird der Authenticator
gefragt, welchen Passkey er hält, statt den hier gespeicherten zu nehmen. Der
zweite Passkey:

- öffnet den Tresor über sein eigenes Fach und damit jede versiegelte Liste;
- liest das Register des ersten Passkeys, die Listenauswahl zeigt also dessen
  Listen;
- schreibt in eine Liste, sobald seine DID dort Schreibrechte hat, wie jede
  andere DID;
- trägt keine Listen in dieses Register ein und vergisst keine: Es gehört dem
  ersten Passkey.

**Wo er funktioniert:** in dem Browser, in dem der Tresor liegt. invoice01
hält nirgends sonst eine Kopie des Tresors. Belege hat dafür einen Index auf
Aleph; dieses Kapitel hat nichts Vergleichbares. Auf einem anderen Gerät ist
der zweite Passkey eine eigene Identität, ohne Inhalt. Geht auch der Speicher
dieses Browsers verloren, geht der Tresor mit, und nur der erste Passkey kann
wieder einen anlegen. Ein zweiter Passkey ist ein Schlüssel zu den Listen
dieses Browsers, keine Sicherung davon.

Im Arbeitsspeicher-Modus lebt der Tresor nur so lange wie der Tab, deshalb wird
das Hinzufügen eines Passkeys dort nicht angeboten.

## Einen Passkey herausnehmen

Das Feld entfernt jeden Passkey außer dem, mit dem gerade gearbeitet wird. Von
da an wird er hier abgewiesen: Er startet als eigene Identität, ohne die
Listen, und bekommt das gesagt.

Was das Entfernen nicht kann: zurücknehmen, was dieser Passkey gesehen hat. Er
hat die Wurzel geöffnet, und die Wurzel ist die PRF-Ausgabe des ersten
Passkeys, die keine Erneuerung ändert. Was er gelesen hat, bleibt für jede
Kopie lesbar, die er behalten hat. Belege kann seinen Tresorschlüssel erneuern;
hier würde das nichts nützen, deshalb wird es nicht angeboten.

## Berührungen

Nichts hier fragt den Passkey, bevor es benutzt wird. Jede Zahl unten wird in
`e2e/list-vault.spec.js` oder `e2e/passkey-restore.spec.js` geprüft.

| Wann                                                                                                         | Berührungen                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Passkey anlegen                                                                                              | 3, wie bisher: der Passkey, seine PRF-Ausgabe, die Identität           |
| Start, hier kein Tresor für diesen Passkey                                                                   | wie bisher                                                             |
| Start, hier ein Tresor für diesen Passkey                                                                    | 1 mehr: die PRF-Ausgabe, und der Tresor geht auf                       |
| Die erste versiegelte Liste oder der erste zweite Passkey, in der Sitzung, in der der Passkey angelegt wurde | keine: seine PRF-Ausgabe wurde bei der Registrierung gelesen           |
| Dasselbe in einer späteren Sitzung ohne offenen Tresor                                                       | 1, am Passkey, mit dem gearbeitet wird                                 |
| Einen zweiten Passkey hinzufügen                                                                             | 2, am neuen: anlegen und seine PRF-Ausgabe                             |
| Als zweiter Passkey starten                                                                                  | 4: zwei, um ihn zu finden, eine für den Tresor, eine für die Identität |

## Datenformat

Diese Zeichenketten gehören zu den Daten. Wer eine ändert, macht Vorhandenes
unlesbar:

- `simple-todo/invoice01/vault-slot/v1`: der Fachschlüssel eines Passkeys;
- `simple-todo/invoice01/list-key/v1`: der Listenschlüssel, aus der Wurzel;
- `simpleTodo.invoice01.vaults.v1`: wo der Tresor liegt.

Ein unlesbarer Speicher bleibt, wie er ist, und wird nie ersetzt, weil er die
einzige Kopie eines Tresors enthalten kann. Versiegelte Listen bleiben dann zu,
und der Start sagt das.
