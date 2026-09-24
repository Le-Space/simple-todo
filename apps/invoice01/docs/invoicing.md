# Invoicing in `invoice01`

An invoice is a document somebody else relies on: the tax office, an auditor,
the customer's bookkeeping. This chapter writes one from a replicated,
append-only log — which turns out to fit the rules better than a file that can
be overwritten, provided the data model is chosen with that in mind.

None of this is legal advice, and none of it has been through a tax adviser. It
is written down because every design decision below leans on one of these rules.

## The two states

A **draft** is an ordinary entry in the list. Anyone who may write to the list
may change it, as often as they like.

**Issuing** is the act that ends that. It

- assigns the number from this identity's series,
- copies the issuer and the customer into the invoice as they are at that
  moment,
- computes the totals and stores them beside the lines as a witness,
- and writes the result once.

Afterwards the invoice is not edited. §31 Abs. 5 UStDV corrects an invoice
rather than changing it, and whoever states VAT owes it under §14c UStG until a
correction exists. A **Storno** is therefore its own invoice: the same lines
with negated quantities, and a reference to the number it takes back. The app
folds the pair back together for the reader; the log keeps both.

This is also the only shape an append-only log can honour. Marking the original
"cancelled" would mean rewriting it, and every replica would still hold what it
already had.

## The number

`2026-48213-001` — the year, five digits standing for the identity that issues,
then a counter that restarts each year.

§14 Abs. 4 Satz 1 Nr. 4 UStG asks for "eine fortlaufende Nummer mit einer oder
mehreren Zahlenreihen, die zur Identifizierung der Rechnung vom
Rechnungsaussteller **einmalig** vergeben wird". The operative word is
_einmalig_, not _lückenlos_. UStAE 14.5 Abs. 10 spells out what that permits:
several number ranges, gaps, and letters mixed in.

That is what makes a local answer legitimate rather than a workaround. Each
identity writes in a series of its own, so two devices that cannot see each
other can both issue an invoice, and neither needs a counter the other agrees
with. The next number is derived from the numbers already issued in that
series — never from a counter stored on the side, which a second device would
not know about.

**Identity is not the same as device.** The identity comes from the passkey: one
hardware key used on two phones is one identity with one series, while a
platform passkey per device gives each device its own. Where a series really is
shared by two devices that are both offline, the app's duplicate detection is
what catches it.

**Why digits rather than the identity's own characters.** A DID is base58, where
`a2doK` and `A2DOK` are different strings. An invoice number is read aloud,
typed into a bank transfer and scanned out of a PDF, and none of those survive a
case distinction. The five digits are derived from the DID instead. Two
identities that land on the same five digits share one series and count past
each other — a collision costs a shared series, never a duplicate number.

## The wording, as a template

The layout is drawn and stays drawn. What belongs to whoever sends the invoice
is the wording: the letter above the lines and the closing under them. Those
live in one small Markdown document, edited in the app beside a preview,
downloadable as a file, changeable in any editor and uploadable again.

```markdown
## Anschreiben

Sehr geehrte Damen und Herren,

vielen Dank für Ihren Auftrag. Die Rechnungsnummer **{{nummer}}** bitten wir
als Verwendungszweck anzugeben.

## Schluss

Mit freundlichen Grüßen
{{aussteller.geschaeftsfuehrer}}
```

It is deliberately a subset: `## heading` opens a block, a blank line separates
paragraphs, `- ` makes a bullet, `**bold**` is bold, and a line break somebody
typed stays a line break — strict Markdown would join "Mit freundlichen Grüßen"
and the name below it into one line, and nobody writing a letter means that.

Two blocks are known, under either language's name: _intro_ (Anschreiben,
Letter) and _closing_ (Schluss, Sign-off). A heading nobody knows keeps its text
off the invoice, and the editor says so rather than swallowing it. Placeholders
that resolve to nothing stay on the page as written — a gap in an invoice is
invisible, `{{kunde.nmae}}` is not.

Placeholders read the invoice's own figures under German or English names:
`{{nummer}}`/`{{number}}`, `{{betrag}}`, `{{faellig}}`, `{{kunde.name}}`,
`{{kunde.anschrift}}`, `{{aussteller.geschaeftsfuehrer}}`, `{{aussteller.iban}}`
and the rest of the issuer's block.

**Issuing freezes it.** The template travels into the invoice, like the
addresses and the totals, so re-exporting an invoice from two years ago produces
what it said then rather than what the template says now.

## What the footer says, and where it comes from

Everything on the printed invoice beyond the lines is issuer master data, kept
in the list so every device prints the same: name and address, VAT id and tax
number, email, phone and website, the register court and number, the managing
director, the bank, and — for whoever wants them — a Bitcoin and an Ethereum
address. A logo is uploaded once and stored with them.

§14 Abs. 4 UStG governs the invoice's own particulars; the register entry and
the managing director are §35a GmbHG's business, and the bank is nobody's but
the customer's, who has to pay it somehow. All of it is optional: a line nobody
filled in is left out rather than printed as a bare label.

The logo is scaled to 600 pixels and kept as a PNG, whatever was uploaded. That
bounds what travels with the list, and it is also how an SVG becomes something
the PDF can embed.

## The GiroCode

Where a bank account is set and there is a positive amount to pay, the invoice
carries an EPC069-12 code — the GiroCode. A banking app that scans it fills in
recipient, IBAN, amount and reference by itself, and the reference is the
invoice number, which is what makes a payment matchable when it arrives.

A Storno carries none: it owes money the other way, and no credit transfer can
express that.

Amounts are printed without the euro sign. The PDF does not embed its font, so
a viewer substitutes its own Helvetica, and where that one's euro glyph is
narrower than the metrics promise, everything after it shifts left — a rendered
page read "1.190,00 €bis zum 02.10.2026". The document names the currency in its
headings instead, as the template it follows does.

## Money

Amounts are integer cents; quantities are scaled to ten-thousandths; each figure
is rounded exactly once, half away from zero. VAT is taken per rate on the sum
of that rate's lines, not per line, because that is the figure EN 16931 checks
(BT-116 × BT-119). An invoice whose lines miss their totals by a cent fails
BR-CO-10 or BR-CO-15, and with them every e-invoice validator.

Three tax modes are supported: standard, §19 UStG (Kleinunternehmer, no VAT is
shown) and §13b UStG (reverse charge, the recipient owes the tax and must be
named with their VAT id). Each carries the sentence it is obliged to carry.

## What the chapter does not do

- **No XRechnung or ZUGFeRD export.** Since 1 January 2025 every domestic
  business must be able to _receive_ a structured e-invoice; the duty to _issue_
  one is phased in afterwards. `money.js` already computes to EN 16931's rules,
  so the data is ready when the export is written.
- **No customer directory.** Every invoice carries its own copy of the address.
  A directory is personal data, and what a replicated log can and cannot forget
  deserves its own stage rather than a footnote.
- **No payment matching**, and nothing is sent anywhere.

## Retention, and what cannot be deleted

An issued invoice is a Buchungsbeleg. Since the Viertes
Bürokratieentlastungsgesetz the retention period is **eight** years (§147 Abs. 1
Nr. 4 in connection with Abs. 3 Satz 1 AO), extended where an assessment period
is still open. Art. 17 Abs. 3 lit. b GDPR exempts data kept for a legal
retention duty, so an issued invoice stays even when a customer asks for
erasure.

The app therefore offers no way to delete an issued invoice — only to cancel
it. A draft can be deleted, because nothing obliges anyone to keep it.

And the honest limit: this is an append-only log replicated to every device that
has the list. What is written stays written, on every replica. That is what makes
it good evidence and what makes deletion impossible; both halves are true, and
the second one is the reason the customer directory is not in this chapter yet.

## Where it lives

| File                           | What it decides                                        |
| ------------------------------ | ------------------------------------------------------ |
| `src/lib/invoice/money.js`     | cents, rounding, VAT per rate, German input and output |
| `src/lib/invoice/numbering.js` | number circles: pattern, reset rule, the next number   |
| `src/lib/invoice/series.js`    | the identity's own series                              |
| `src/lib/invoice/records.js`   | draft, issuing, Storno, the totals witness             |
| `src/lib/invoice/settings.js`  | issuer and circles, stored in the list                 |
| `src/lib/invoice/document.js`  | what the printed invoice says                          |
| `src/lib/invoice/pdf.js`       | where it sits on the page                              |
