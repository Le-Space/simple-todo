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
