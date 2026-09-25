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

## The customer directory, and what "delete" can mean

Typing an address into every invoice is not an interface anybody uses twice, so
customers are their own records beside the invoices: name, address, VAT id, and
the tax mode and payment terms an invoice for them starts from. Pick one and the
invoice's customer block fills in; keep the one you have just typed; or start an
invoice straight from the directory.

**An issued invoice keeps a copy, not a reference.** When a customer moves, last
year's invoice must still show where they were when it was issued — the
accounting rule and the log's own nature agree here, because a reference would
rewrite history and a copy cannot.

Then the uncomfortable part, which belongs in the chapter rather than in a
footnote. A customer record is personal data. Art. 17 GDPR gives a person the
right to have it erased; §147 AO obliges the business to keep issued invoices
for eight years. Those do not contradict each other — retention wins for the
invoice, erasure applies to everything that is not one — but **an append-only
log replicated to every device cannot forget either way.** Marking a directory
entry deleted hides it in the app and removes nothing from the log, and every
replica keeps the entry it already has.

So the app does exactly that, and says so where somebody deleting can read it.
It does not offer an erasure it cannot perform.

**Not sealed yet — and the way it will be is decided.** The directory lives in
the list, so whoever the list is shared with gets it. Invoices therefore belong
in a list of your own rather than a shared one.

The plan, settled on 2026-09-24: the list's own OrbitDB database gets the
`encryption` option — `payloadEncryption` in `entry-encryption.js`, which this
chapter already carries from `privacy01` — and the key comes from the passkey,
not from local storage. The identity provider exports
`extractPrfSeedFromCredential`, so the same credential that already _is_ the
identity derives the key: one passkey opens the list on every device it is
present on, nothing is handed over, and a list somebody else holds is blocks
they cannot read. `database-keys.js` is the seam that changes; what it calls
"Phase 2" is this.

It is not built yet, and this paragraph is the honest description of where that
leaves the directory in the meantime.

## A line, and what it was about

An invoice that a customer can check is an invoice that gets paid. Beside the
figures, a line carries two optional things: a **subtitle** — the one-line
context, "Doichain Core 31.1 · Aufwand 9,5 Std." — and **bullet points** saying
what was actually done.

Neither touches an amount. `computeTotals` never sees them, and a line with four
bullets sums exactly as the same line without them. They exist because the
alternative is an invoice that reads "Beratung, 2 Tage, 1.000,00" and an email
thread asking what that was.

A page break falls between lines rather than inside their figures, and the table
header repeats at the top of the next page.

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

The PDF carries its own font. A subset of DejaVu Sans is embedded, so the euro
sign, and a customer whose name leaves Latin-1, are drawn rather than left to
whatever the viewer substitutes. Before that, a substituted Helvetica whose euro
advance differs from the metrics shifted everything after it: a rendered page
read "1.190,00 €bis zum 02.10.2026".

## The head, and where the delivery date went

The head carries what somebody acts on: the number, the invoice date, the
customer number where there is one, and the day the money is due.

**The delivery date is under the table instead.** §14 Abs. 4 Nr. 6 UStG asks
for the time of supply on the invoice — the calendar month is enough — and
where it sits is ours to choose. Without it the _recipient's_ input-tax
deduction is what is at risk, which is why it is on the document at all rather
than left to the line descriptions.

Amounts in the table stay plain and the note names the currency once, as the
template does; the sum carries the euro sign, because that is the figure
somebody looks for. Where no font could be embedded, the sign falls back to its
own positioned run, so the rest of the line stays where it belongs.

## When one number goes out twice

Every identity issues in a series of its own, so this cannot happen between two
people. It can happen between two devices that are the _same_ identity — one
passkey on a laptop and a phone — when both are offline and both issue: each
reads the numbers it can see, and neither can see the other's. The same follows
a restore. And it is a deliberate possibility whenever somebody sets a pattern
without the identity's digits, which is exactly what carrying a series over from
another program looks like.

The app therefore does three things, none of them quietly:

1. **It detects it.** Two issued invoices with one number, neither taken back.
2. **It says so** — once above the list, and on both rows.
3. **It offers the correction.** The invoice that went out first keeps its
   number, because somebody is already holding it; the later one gets a Storno
   and a copy of itself as a draft, to be issued under the next free number.
   §31 Abs. 5 UStDV, rather than a renumbering nobody told the customer about.

Which of the two gives way is decided by `issuedAt`, and by the id where two
devices managed the same instant — so both devices reach the same answer without
being able to ask each other.

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
- **No payment matching**, and nothing is sent anywhere.
- **Todos do not become invoice lines.** Both live in the same list, but a todo
  carries no hours and no rate, so an invoice is typed rather than collected.

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
the second one is why the directory's "delete" hides an entry and says so.

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
