# Rechnungen in `invoice01`

Eine Rechnung ist ein Dokument, auf das sich andere verlassen: das Finanzamt,
eine Prüferin, die Buchhaltung des Kunden. Dieses Kapitel schreibt sie aus einem
replizierten Log, das nichts vergisst — und das passt zu den Regeln besser als
eine Datei, die man überschreiben kann, sofern man das Datenmodell danach wählt.

Nichts davon ist Rechtsberatung, und nichts davon hat ein Steuerberater gesehen.
Es steht hier, weil jede Entscheidung weiter unten auf einer dieser Regeln ruht.

## Die zwei Zustände

Ein **Entwurf** ist ein gewöhnlicher Eintrag in der Liste und lässt sich
beliebig oft ändern.

**Ausstellen** beendet das. Dabei

- wird die Nummer aus der Reihe dieser Identität vergeben,
- werden Aussteller und Kunde so in die Rechnung kopiert, wie sie in diesem
  Moment sind,
- werden die Summen berechnet und als Zeuge neben den Positionen abgelegt,
- und das Ergebnis einmal geschrieben.

Danach wird die Rechnung nicht mehr bearbeitet. § 31 Abs. 5 UStDV berichtigt
eine Rechnung, statt sie zu ändern, und wer Umsatzsteuer ausweist, schuldet sie
nach § 14c UStG, bis eine Berichtigung existiert. Ein **Storno** ist deshalb
eine eigene Rechnung: dieselben Positionen mit negierten Mengen und ein Verweis
auf die Nummer, die sie zurücknimmt. Die App führt beide für den Leser wieder
zusammen; das Log behält beide.

Das ist zugleich die einzige Form, die ein Append-only-Log ehrlich abbilden
kann. Das Original als „storniert" zu markieren hieße, es zu überschreiben — und
jede Kopie auf jedem Gerät hätte trotzdem noch, was sie schon hatte.

## Die Nummer

`2026-48213-001` — das Jahr, fünf Ziffern für die ausstellende Identität, dann
ein Zähler, der jedes Jahr neu beginnt.

§ 14 Abs. 4 Satz 1 Nr. 4 UStG verlangt „eine fortlaufende Nummer mit einer oder
mehreren Zahlenreihen, die zur Identifizierung der Rechnung vom
Rechnungsaussteller **einmalig** vergeben wird". Das maßgebliche Wort ist
_einmalig_, nicht _lückenlos_. UStAE 14.5 Abs. 10 sagt ausdrücklich, was damit
erlaubt ist: mehrere Zahlenreihen, Lücken und Buchstaben in der Nummer.

Genau das macht die lokale Lösung zulässig statt zum Behelf. Jede Identität
schreibt in ihrer eigenen Reihe, also können zwei Geräte, die sich nicht sehen,
beide eine Rechnung ausstellen, ohne sich auf einen Zähler zu einigen. Die
nächste Nummer wird aus den bereits vergebenen Nummern derselben Reihe
abgeleitet — nie aus einem Zähler daneben, von dem ein zweites Gerät nichts
wüsste.

**Identität ist nicht dasselbe wie Gerät.** Die Identität kommt aus dem Passkey:
ein Hardware-Schlüssel an zwei Telefonen ist eine Identität mit einer Reihe,
während ein Geräte-Passkey je Gerät jedem Gerät seine eigene gibt. Wo sich zwei
Geräte eine Reihe tatsächlich teilen und beide offline sind, greift die
Doppel-Erkennung der App.

**Warum Ziffern und nicht die Zeichen der Identität.** Eine DID ist base58, dort
sind `a2doK` und `A2DOK` verschiedene Zeichenketten. Eine Rechnungsnummer wird
vorgelesen, in eine Überweisung getippt und aus einem PDF gescannt — nichts
davon übersteht eine Unterscheidung nach Groß- und Kleinschreibung. Die fünf
Ziffern werden deshalb aus der DID abgeleitet. Zwei Identitäten mit denselben
fünf Ziffern teilen sich eine Reihe und zählen aneinander vorbei: Das kostet
eine gemeinsame Reihe, nie eine doppelte Nummer.

## Das Kundenverzeichnis, und was „löschen" heißen kann

Eine Anschrift in jede Rechnung zu tippen ist keine Oberfläche, die jemand
zweimal benutzt. Kunden sind deshalb eigene Datensätze neben den Rechnungen:
Name, Anschrift, USt-IdNr. und die Besteuerung und das Zahlungsziel, mit denen
eine Rechnung an sie beginnt. Einen auswählen füllt den Kundenblock; den gerade
getippten kann man behalten; und aus dem Verzeichnis heraus beginnt die nächste
Rechnung.

**Eine ausgestellte Rechnung trägt eine Kopie, keinen Verweis.** Zieht ein Kunde
um, muss die Rechnung vom letzten Jahr weiterhin zeigen, wo er damals saß — die
Buchhaltungsregel und die Natur des Logs sind sich hier einig: Ein Verweis würde
Geschichte umschreiben, eine Kopie kann das nicht.

Und nun der unangenehme Teil, der ins Kapitel gehört und nicht in eine Fußnote.
Ein Kundendatensatz sind personenbezogene Daten. Art. 17 DSGVO gibt einer Person
das Recht auf Löschung; § 147 AO verpflichtet den Betrieb, ausgestellte
Rechnungen acht Jahre aufzubewahren. Das widerspricht sich nicht — für die
Rechnung gewinnt die Aufbewahrung, die Löschung gilt für alles andere — aber
**ein repliziertes Append-only-Log kann in beide Richtungen nicht vergessen.**
Einen Verzeichniseintrag als gelöscht zu markieren verbirgt ihn in der App und
entfernt nichts aus dem Log, und jede Kopie behält, was sie schon hat.

Genau das tut die App, und sie sagt es dort, wo jemand löscht. Sie verspricht
keine Löschung, die sie nicht leisten kann.

**Noch nicht versiegelt — aber der Weg steht fest.** Das Verzeichnis liegt in
der Liste, wer die Liste bekommt, bekommt es mit. Rechnungen gehören deshalb in
eine eigene Liste, nicht in eine geteilte.

Der Plan, entschieden am 24.09.2026: Die OrbitDB-Datenbank der Liste bekommt die
`encryption`-Option — `payloadEncryption` aus `entry-encryption.js`, das dieses
Kapitel von `privacy01` ohnehin mitbringt — und der Schlüssel kommt aus dem
Passkey statt aus dem Local Storage. Der Identity-Provider exportiert
`extractPrfSeedFromCredential`; damit leitet dasselbe Credential, das schon die
Identität _ist_, auch den Schlüssel ab: Ein Passkey öffnet die Liste auf jedem
Gerät, auf dem er vorhanden ist, es wird nichts übergeben, und wer die Liste
sonst hat, hat unlesbare Blöcke. `database-keys.js` ist die Naht, die sich
ändert; was dort „Phase 2" heißt, ist genau das.

Gebaut ist es nicht, und dieser Absatz ist die ehrliche Beschreibung dessen, wo
das Verzeichnis bis dahin steht.

## Eine Position, und worum es ging

Eine Rechnung, die der Kunde nachvollziehen kann, wird bezahlt statt
hinterfragt. Neben den Zahlen trägt eine Position zwei freiwillige Dinge: eine
**Unterzeile** — der Einzeiler mit dem Zusammenhang, „Doichain Core 31.1 ·
Aufwand 9,5 Std." — und **Stichpunkte**, die sagen, was tatsächlich getan wurde.

Beides rührt keinen Betrag an. `computeTotals` sieht es nie, und eine Position
mit vier Stichpunkten summiert sich genau wie dieselbe Position ohne. Es gibt
sie, weil die Alternative eine Rechnung ist, auf der „Beratung, 2 Tage,
1.000,00" steht — und ein E-Mail-Wechsel darüber, was das war.

Ein Seitenumbruch fällt zwischen zwei Positionen, nicht in die Zahlen einer
hinein, und der Tabellenkopf wiederholt sich oben auf der nächsten Seite.

## Die Texte, als Vorlage

Das Layout ist gezeichnet und bleibt es. Was demjenigen gehört, der die Rechnung
schickt, sind die Texte: das Anschreiben über den Positionen und der Schluss
darunter. Sie stehen in einem kleinen Markdown-Dokument, das sich in der App
neben einer Voransicht bearbeiten, als Datei herunterladen, in jedem Editor
ändern und wieder hochladen lässt.

```markdown
## Anschreiben

Sehr geehrte Damen und Herren,

vielen Dank für Ihren Auftrag. Die Rechnungsnummer **{{nummer}}** bitten wir
als Verwendungszweck anzugeben.

## Schluss

Mit freundlichen Grüßen
{{aussteller.geschaeftsfuehrer}}
```

Bewusst nur eine Teilmenge: `## Überschrift` öffnet einen Block, eine Leerzeile
trennt Absätze, `- ` macht eine Aufzählung, `**fett**` ist fett, und ein
getippter Zeilenumbruch bleibt ein Zeilenumbruch — striktes Markdown würde „Mit
freundlichen Grüßen" und den Namen darunter zu einer Zeile verbinden, und das
meint niemand, der einen Brief schreibt.

Zwei Blöcke sind bekannt, unter dem Namen beider Sprachen: _Anschreiben_
(intro, letter) und _Schluss_ (closing, sign-off). Eine unbekannte Überschrift
hält ihren Text von der Rechnung fern, und der Editor sagt das, statt ihn
stillschweigend zu schlucken. Platzhalter, die ins Leere zeigen, bleiben stehen,
wie sie dastehen — eine Lücke in einer Rechnung sieht niemand, `{{kunde.nmae}}`
schon.

Platzhalter greifen auf die Zahlen der Rechnung zu, deutsch oder englisch
benannt: `{{nummer}}`/`{{number}}`, `{{betrag}}`, `{{faellig}}`,
`{{kunde.name}}`, `{{kunde.anschrift}}`, `{{aussteller.geschaeftsfuehrer}}`,
`{{aussteller.iban}}` und der Rest des Ausstellerblocks.

**Das Ausstellen friert sie ein.** Die Vorlage wandert in die Rechnung, wie die
Anschriften und die Summen. Wer eine zwei Jahre alte Rechnung noch einmal
exportiert, bekommt, was damals daraufstand, nicht was die Vorlage heute sagt.

## Was in der Fußzeile steht, und woher es kommt

Alles auf der gedruckten Rechnung außer den Positionen sind Stammdaten des
Ausstellers, gespeichert in der Liste, damit jedes Gerät dasselbe druckt: Name
und Anschrift, USt-IdNr. und Steuernummer, E-Mail, Telefon und Webseite,
Registergericht und -nummer, Geschäftsführer, die Bankverbindung und — wer mag —
eine Bitcoin- und eine Ethereum-Adresse. Ein Logo wird einmal hochgeladen und
dort mit abgelegt.

§ 14 Abs. 4 UStG regelt die Angaben der Rechnung selbst; Registereintrag und
Geschäftsführer sind Sache des § 35a GmbHG, und die Bankverbindung ist Sache des
Kunden, der irgendwie bezahlen soll. Alles ist freiwillig: Eine Zeile, die
niemand ausgefüllt hat, entfällt, statt als leeres Etikett gedruckt zu werden.

Das Logo wird auf 600 Pixel verkleinert und als PNG gespeichert, egal was
hochgeladen wurde. Das begrenzt, was mit der Liste reist, und macht aus einem
SVG zugleich etwas, das die PDF einbetten kann.

## Der GiroCode

Wo eine Bankverbindung hinterlegt ist und ein positiver Betrag offensteht, trägt
die Rechnung einen EPC069-12-Code — den GiroCode. Eine Banking-App, die ihn
scannt, übernimmt Empfänger, IBAN, Betrag und Verwendungszweck von selbst, und
der Verwendungszweck ist die Rechnungsnummer. Genau daran hängt, ob sich eine
eingehende Zahlung zuordnen lässt.

Ein Storno trägt keinen: Es schuldet Geld in die andere Richtung, und das kann
keine Überweisung ausdrücken.

Beträge werden ohne Euro-Zeichen gedruckt. Die PDF bettet ihre Schrift nicht
ein, ein Betrachter setzt also seine eigene Helvetica ein — und wo deren
Euro-Zeichen schmaler ist als die Metrik verspricht, rutscht alles dahinter nach
links. Auf einer gerenderten Seite stand deshalb „1.190,00 €bis zum 02.10.2026".
Stattdessen nennt das Dokument die Währung in den Überschriften, so wie die
Vorlage es tut.

## Der Kopf, und wohin das Leistungsdatum gewandert ist

Im Kopf steht, wonach jemand handelt: die Nummer, das Rechnungsdatum, die
Kundennummer, sofern es eine gibt, und der Tag, an dem das Geld fällig ist.

**Das Leistungsdatum steht stattdessen unter der Tabelle.** § 14 Abs. 4 Nr. 6
UStG verlangt den Zeitpunkt der Leistung auf der Rechnung — der Kalendermonat
genügt —, und wo er steht, ist unsere Wahl. Ohne ihn steht der Vorsteuerabzug
des _Empfängers_ auf dem Spiel; deshalb steht er überhaupt auf dem Beleg und
nicht bloß in den Positionstexten.

Die Beträge in der Tabelle bleiben schmucklos und der Hinweis nennt die Währung
einmal, wie in der Vorlage; die Summe trägt das Euro-Zeichen, denn das ist die
Zahl, nach der jemand sucht. Das Zeichen wird als eigener, selbst gesetzter
Textlauf gezeichnet — warum das nötig ist, steht in `money.js`.

## Wenn eine Nummer zweimal hinausgeht

Jede Identität stellt in ihrer eigenen Reihe aus, zwischen zwei Personen kann
das also nicht passieren. Zwischen zwei Geräten _derselben_ Identität schon —
ein Passkey auf Laptop und Telefon —, wenn beide offline sind und beide
ausstellen: Jedes liest die Nummern, die es sehen kann, und keines sieht die des
anderen. Nach einer Wiederherstellung gilt dasselbe. Und es ist eine bewusste
Möglichkeit, sobald jemand ein Muster ohne die Kennziffer der Identität setzt —
genau so sieht eine übernommene Reihe aus.

Die App tut deshalb dreierlei, nichts davon stillschweigend:

1. **Sie erkennt es.** Zwei ausgestellte Rechnungen mit einer Nummer, keine
   davon zurückgenommen.
2. **Sie sagt es** — einmal über der Liste und an beiden Zeilen.
3. **Sie bietet die Korrektur an.** Die zuerst ausgestellte Rechnung behält ihre
   Nummer, denn die hat der Kunde bereits; die spätere bekommt ein Storno und
   eine Kopie ihrer selbst als Entwurf, auszustellen unter der nächsten freien
   Nummer. § 31 Abs. 5 UStDV statt einer Umnummerierung, von der der Kunde nie
   erfährt.

Wer von beiden weicht, entscheidet `issuedAt` — und bei gleichem Zeitpunkt die
Id, damit beide Geräte zur selben Antwort kommen, ohne sich fragen zu können.

## Geld

Beträge sind ganze Cent, Mengen in Zehntausendsteln, und jede Zahl wird genau
einmal gerundet, kaufmännisch. Die Umsatzsteuer wird je Satz auf die Summe der
Netto-Beträge dieses Satzes berechnet, nicht je Position — das ist die Zahl, die
EN 16931 prüft (BT-116 × BT-119). Eine Rechnung, deren Positionen die Summen um
einen Cent verfehlen, scheitert an BR-CO-10 oder BR-CO-15 und damit an jedem
E-Rechnungs-Prüfer.

Drei Besteuerungsarten: Regelbesteuerung, § 19 UStG (Kleinunternehmer, es wird
keine Umsatzsteuer ausgewiesen) und § 13b UStG (Reverse Charge, der Empfänger
schuldet die Steuer und muss mit seiner USt-IdNr. genannt sein). Jede trägt den
Satz, den sie tragen muss.

## Was dieses Kapitel nicht tut

- **Kein XRechnungs- oder ZUGFeRD-Export.** Seit dem 1. Januar 2025 muss jedes
  inländische Unternehmen strukturierte E-Rechnungen _empfangen_ können; die
  Pflicht, sie zu _stellen_, kommt später. `money.js` rechnet bereits nach
  EN 16931, die Daten sind also bereit, wenn der Export geschrieben wird.
- **Kein Kundenverzeichnis.** Jede Rechnung trägt ihre eigene Kopie der
  Anschrift. Ein Verzeichnis sind personenbezogene Daten, und was ein
  repliziertes Log vergessen kann und was nicht, verdient eine eigene Stufe
  statt einer Fußnote.
- **Kein Zahlungsabgleich**, und nichts wird irgendwohin verschickt.

## Aufbewahrung, und was sich nicht löschen lässt

Eine ausgestellte Rechnung ist ein Buchungsbeleg. Seit dem Vierten
Bürokratieentlastungsgesetz beträgt die Aufbewahrungsfrist **acht** Jahre
(§ 147 Abs. 1 Nr. 4 in Verbindung mit Abs. 3 Satz 1 AO), länger, solange eine
Festsetzungsfrist offen ist. Art. 17 Abs. 3 lit. b DSGVO nimmt Daten aus, die
einer gesetzlichen Aufbewahrungspflicht unterliegen — eine ausgestellte Rechnung
bleibt also auch dann, wenn ein Kunde Löschung verlangt.

Die App bietet deshalb keinen Weg, eine ausgestellte Rechnung zu löschen,
sondern nur, sie zu stornieren. Ein Entwurf lässt sich löschen, denn ihn muss
niemand aufbewahren.

Und die ehrliche Grenze: Dies ist ein Append-only-Log, repliziert auf jedes
Gerät, das die Liste hat. Was geschrieben ist, bleibt geschrieben, auf jeder
Kopie. Das macht es zu einem guten Beleg und macht Löschen unmöglich; beides ist
wahr, und das Zweite ist der Grund, warum das Kundenverzeichnis noch nicht in
diesem Kapitel steckt.

## Wo es liegt

| Datei                          | Worüber sie entscheidet                               |
| ------------------------------ | ----------------------------------------------------- |
| `src/lib/invoice/money.js`     | Cent, Rundung, USt je Satz, deutsche Ein- und Ausgabe |
| `src/lib/invoice/numbering.js` | Nummernkreise: Muster, Reset-Regel, nächste Nummer    |
| `src/lib/invoice/series.js`    | die eigene Reihe der Identität                        |
| `src/lib/invoice/records.js`   | Entwurf, Ausstellen, Storno, der Summen-Zeuge         |
| `src/lib/invoice/settings.js`  | Aussteller und Kreise, in der Liste gespeichert       |
| `src/lib/invoice/document.js`  | was auf der gedruckten Rechnung steht                 |
| `src/lib/invoice/pdf.js`       | wo es auf der Seite steht                             |
