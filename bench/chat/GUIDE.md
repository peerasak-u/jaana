# Writing chat address records

GUIDE v3, 2026-11-19, adds the `R` mark for delivery notes (see
[R, the delivery note](#r-the-delivery-note)). Every other rule is v2, so a v2
file stays valid and simply has no `R` marks.

GUIDE v2, 2026-11-16. Changes from v1: a bracket after a name that holds a
contact handle or a place name is outside `N`, and so is the label
`ชื่อเล่น`; `P` keeps 9 to 12 digits as typed; the `warn:` header; records
with several deliveries.

This is the contract for everyone who writes records under
`bench/chat/sources/`. A record is one message a Thai online shopper sent to a
seller in a chat, plus marks that say which characters are the name, phone,
address detail, subdistrict, district, province, and postcode.

Read `bench/chat/STYLE-NOTES.md` first. It describes how real shoppers write.
Write what a real seller's inbox looks like, not a tidy textbook address.

## File format

One file per category and writer: `bench/chat/sources/<pool>/<category>.txt`
or `<category>.<writer>.txt`. `<pool>` is `bench` or `train`.

```
===
loc: ดอนกระเบื้อง | โพธาราม | ราชบุรี | 70120
tags: multiline, landmark
---
ส่งที่นี่นะคะ
[[N:คุณวิไลพร ทองดี]] โทร [[P:089-123-4567]]
[[A:45/2 ม.3 ซ.วัดดอน]] [[S:ต.ดอนกระเบื้อง]] [[D:อ.โพธาราม]] [[V:จ.ราชบุรี]] [[Z:70120]]
ขอบคุณค่ะ 🙏
===
loc: สำโรงเหนือ | เมืองสมุทรปราการ | สมุทรปราการ | 10270
tags: typo-province, thai-digits, name-last
---
[[A:99 หมู่บ้านสุขใจ]] โทร[[P:๐๘๑ ๒๓๔ ๕๖๗๘]] [[D:อ.เมือง]] [[V:สมุทรปรากาน]][[Z:10270]] [[N:บจก.รุ่งเรืองการค้า (คุณเอ)]]
```

- A line that is exactly `===` starts a record.
- `loc:` is the true location as `subdistrict | district | province | postcode`.
  Copy it from the sampler output. It is the answer key for the
  administrative fields, whatever the message spells. A record with several
  deliveries has `loc1:`, `loc2:`, ... instead (see
  [Several deliveries](#several-deliveries)).
- `tags:` is optional, comma separated, free text. Name the phenomena in the
  message (`typo-district`, `no-newline`, `two-phones`, `company`, and so on).
- `warn:` is the comma-separated list of warnings the parser should raise for
  this message (see [Warnings](#warnings)). Leave it out when there are none.
- Each header line appears at most once. A second `loc:` is an error, not a
  correction.
- A line that is exactly `---` ends the header. Everything after it, up to the
  next `===`, is the message. Line breaks are kept. Trailing blank lines are
  dropped.
- The message is exactly what the shopper typed, with `[[X:...]]` wrapped
  around each field. Removing the marks must leave the original message.
  Typos, missing spaces, and odd punctuation stay as typed.

## Marks

| Mark | Field | How many |
|---|---|---|
| `N` | recipient name | at most one |
| `P` | phone | at most one |
| `A` | address detail | any number of pieces |
| `S` | subdistrict (ตำบล, แขวง) | at most one |
| `D` | district (อำเภอ, เขต) | at most one |
| `V` | province | at most one |
| `Z` | postcode | at most one |
| `R` | delivery note | any number of pieces |

A mark never starts or ends with a space. Only `A` may contain a line break.
`R` never overlaps another mark.
A field the shopper did not write gets no mark. Do not mark anything else.
"How many" counts per delivery. Marks of a second or later delivery carry its
number: `[[N2:...]]`, `[[P2:...]]`, `[[A2:...]]`.

### N, the recipient

- The one string that names who receives the parcel.
- Include the honorific or title (`คุณ`, `นาย`, `น.ส.`, `ดร.`, `K.`, `Khun`,
  `Mr.`), a nickname in brackets right after the name, and a company's legal
  form (`บริษัท ... จำกัด`, `บจก.`, `หจก.`, `ร้าน`).
- Exclude the label (`ชื่อ:`, `ชื่อเล่น`, `ชื่อเล่น:`, `ชื่อเล่นคือ`, `ผู้รับ`,
  `ส่งให้`, `ถึง`, `attn.`) and any particle after the name (`ค่ะ`, `ครับ`,
  `นะคะ`): `ชื่อเล่น [[N:บีม]]`, never `ชื่อ[[N:เล่น บีม]]`.
- A kinship or call word joined to the name is part of it (`ป้าน้อย`,
  `ลุงสมพงษ์`, `น้องมายด์`, `ครูวาสนา`).
- Brackets written right after the name are part of it when they hold a
  nickname, a relation, a department, or a contact person:
  `[[N:คุณสมศรี ใจดี (แม่)]]`, `[[N:อบต.หนองบัว (กองคลัง)]]`. A label inside
  the brackets does not change this: `[[N:บจก.เอบีซี (attn. คุณบี)]]`.
  The exceptions:
  - Address detail in brackets is `A`: `[[N:รร.บ้านท่า]] ([[A:ม.3]])`.
  - A remark to the seller in brackets is unmarked.
  - A contact handle in brackets is unmarked and not part of `N`. A contact
    bracket is one whose text starts with `LINE`, `Line`, `ไลน์`, `IG`,
    `FB`, `Facebook`, `เฟส`, `ID ไลน์`, `ID LINE`, or `@`: `[[N:คุณบีม]] (LINE: beam_shop)`,
    `[[N:น้องมายด์]] (@mind.mind)`. A word that only contains `ไลน์`, as in
    `(หัวหน้าไลน์ 3)`, is a department and stays in `N`.
  - A place name in brackets is not part of `N`. A place bracket holds only a
    province or district name, with or without its prefix, or a nickname of
    one: `(กทม.)`, `(บางกอก)`, `(เชียงใหม่)`. When it names the `loc:`
    province or district and the message has no other mark of that kind,
    mark it inside the bracket, `[[N:คุณแป้ง]] ([[V:กทม.]])`, with the tag
    `alias` for a nickname. Otherwise leave it unmarked:
    `[[N:สภ.กำแพงเพชร]] (สงขลา)` when `[[V:จ.สงขลา]]` is written later.
- An organisation and its contact person written next to each other are one
  name: `[[N:บจก.รุ่งเรืองการค้า (คุณเอ ฝ่ายจัดซื้อ)]]`. The order does not
  matter: `[[N:ครูวาสนา ปินตา โรงเรียนบ้านดงวิทยา]]`. "Next to each other" means
  on the same line with only spaces, brackets, or a slash between them.
- A department or job title written next to a person without brackets, with no
  organisation on that line, is not part of the name:
  `ฝ่ายจัดซื้อ [[N:คุณกิตติศักดิ์]]`, `[[N:คุณปวีณา]] ฝ่ายบัญชี`. Next to an
  organisation it is part of the organisation: `[[N:รพ.บางซ้าย ฝ่ายเภสัชกรรม]]`.
- When a person and an organisation are written apart, the person is `N` and
  the organisation is part of the place, so it goes in `A`:
  `[[N:คุณสมชาย]]` then `[[A:บริษัท เอบีซี จำกัด 12/3 ถ.มิตรภาพ]]`.
- When there is no person, the organisation is `N`, and `A` starts after it.
- With a buyer and a different recipient, `N` is the recipient. With a proxy
  (`ฝากให้แม่ คุณสมศรี`), `N` is the person who receives (`คุณสมศรี`).

### P, the phone

- Only the number: digits, and any dashes, spaces, dots, `+66`, or `(+66)`
  inside it. Not the label, not an extension (`ต่อ 12`).
- The phone is the recipient's. When the buyer and the recipient each give a
  number, mark the recipient's. When the message gives only one number, mark it,
  whoever it belongs to.
- With two numbers for the same person, mark the first one. The second stays
  unmarked.
  The exception is a correction (`แก้เบอร์เป็น ...`): mark the corrected
  number, because the first one is wrong.
- Mark the number exactly as typed, even when its length is wrong: 9 to 12
  digits starting with 0, or the `+66`/`66` form of one. Never drop a digit to
  make it look right. A number of the wrong length also needs
  `warn: phone-length` (see [Warnings](#warnings)). Invent every number.
- The gold value is the digits as typed: separators and brackets dropped,
  Thai digits made ASCII, a leading `+66`, `0066`, or `66` (and one `0` right
  after it) read as `0`, and nothing cut. `081-234-56789` is `08123456789`.
  `+66 (0)81 234 5678` is `0812345678`.

### A, the address detail

- Everything that locates the place below the subdistrict: house number, `หมู่`,
  village, building, floor, room, soi, road, and a place name used as the
  location (school, company, market, temple).
- A landmark that says where the place is belongs to `A`, brackets included:
  `[[A:12 ม.4 (ตรงข้ามวัดป่า)]]`, `[[A:88/1 ซ.5 ใกล้เซเว่น]]`.
- A sentence of chat that only describes the place in general words, before
  the address itself is written, is not address detail: `ส่งที่ร้านป้าน้อยนะครับ
  ร้านข้าวแกงข้างบ้านผม` stays unmarked when the address line follows.
- An instruction to the courier does not: `โทรก่อนส่ง`, `ฝากไว้ที่ป้อมยาม`,
  `วางหน้าบ้านได้เลย`. Neither do order details, payment notes, or greetings.
- `บ้านเลขที่` and `เลขที่` are part of the house number, so they stay in `A`.
- Exclude the label (`ที่อยู่:`, `ส่งที่`) and punctuation at either edge.
  Punctuation inside stays: `[[A:77/9 ซอยเจริญเมือง 5, ถ.เจริญเมือง]]`.
- When something that is not address detail interrupts it (a phone, a note, an
  administrative field), mark each piece separately. Pieces are joined with one
  space in the order written.

### S, D, V, the administrative names

- Mark the written prefix together with the name: `[[S:ต.ดอนกระเบื้อง]]`,
  `[[D:อำเภอ โพธาราม]]`, `[[V:จังหวัดราชบุรี]]`, `[[S:แขวงมีนบุรี]]`,
  `[[D:เขตมีนบุรี]]`. With no prefix, mark the bare name. Include a trailing
  `ฯ` (`[[V:กรุงเทพฯ]]`).
- A misspelt name is still marked. The `loc:` line holds the right answer.
- `[[D:อ.เมือง]]` is fine. The key resolves it through `loc:`.
- A nickname or romanized form (`กทม`, `โคราช`, `Bangkok`, `Chiang Mai`) is
  marked, and the record needs the tag `alias`.
- A subdistrict and district with the same name written twice: the first is
  `S`, the second is `D`. Written once with no prefix: mark it `D`.
- A place name inside a road or village name (`ถ.สกล-นาแก`,
  `หมู่บ้านเมืองทอง`) is part of `A`, not an administrative field.

### Z, the postcode

- The five digits only, Arabic or Thai. It must be the `loc:` postcode. The
  label (`รหัสไปรษณีย์`) is not part of it.

### R, the delivery note

A delivery note is text the courier or the packer needs for this parcel that
is not already one of the seven fields. Mark it `R`, one piece per clause,
in any number of pieces. Marks of a later delivery are `R2`, `R3`, ...

It is a note when it says one of these:

- Where or with whom to leave the parcel: `ฝากไว้ที่ป้อมยาม`, `ฝากรปภ.ได้เลย`,
  `วางไว้หน้าประตูรั้ว`, `ถ้าไม่อยู่ฝากร้านข้างบ้าน`, `ให้น้องที่ร้านเซ็นรับแทน`.
- When to come or how to reach the person: `โทรก่อนส่ง`, `ส่งช่วงเย็นหลัง 5 โมง`,
  `วันเสาร์ไม่อยู่`, `กดกริ่งแรงๆ`, a warning such as `หมาดุ`.
- How to find the place, when the words are not part of the address detail:
  a landmark, a direction, the entrance, or what the house looks like written
  as its own sentence, after the address or apart from it:
  `บ้านอยู่ตรงข้ามร้านของชำ รั้วสีเขียว`, `เข้าทางประตูหลังหมู่บ้าน`,
  `เลี้ยวซ้ายหลังวัดหลังที่ 3`.
- How it ships or is paid at the door: `เก็บเงินปลายทาง`, `ปลายทาง`, `COD`,
  `ไม่ต้องเก็บปลายทาง`, `ส่ง Kerry`, `ส่ง flash`, `ส่ง EMS`.

Landmark or note. The same words can be either, and the position decides.
A landmark written inside the address detail, between the house number and
the administrative names or right after them on the same line with no
sentence break, is part of `A`, as the A rule says:
`[[A:12 ม.4 ตรงข้ามร้านของชำ]] [[S:ต.ธาตุเชิงชุม]]`. Written as a sentence
of its own, it is `R`: `[[A:88 ม.2]] [[S:ต.หนองบัว]] ... [[P:0812345678]]
[[R:บ้านอยู่ตรงข้ามร้านของชำ]] [[R:รั้วสีเขียว]]`. A sentence that says it
with a verb or a subject (`บ้านอยู่`, `อยู่`, `ถ้าหาไม่เจอ`, `เข้าทาง`) is a
sentence of its own.

Not a note: greetings, thanks, apologies, order items, sizes, colours,
quantities, prices, `โอนแล้ว`, slips, questions about stock or delivery
time (`ได้ของวันไหนคะ`), field labels, contact handles (`LINE: ...`),
tax-invoice requests, packing and gift-wrap requests (`แพ็คดีๆ`,
`ห่อของขวัญ`, `แยกกล่อง`), `ส่งด่วน`, a second phone number, the proxy phrase
`ฝากส่งให้แม่` (it asks the seller to send to someone; the name is `N`),
and a sentence that only repeats what the address
already says (`ส่งที่ร้านในห้างค่ะ` before the shop's full address). The
general place sentence that the A rule leaves unmarked stays unmarked when it
adds nothing the address does not say.

Boundaries:

- One `R` per clause. Two notes separated by a space, a line break or other
  text are two pieces. A reason joined to its note stays in it:
  `[[R:ส่งช่วงเย็นหลัง 5 โมง]]นะจ๊ะ [[R:กลางวันไปกรีดยาง]]`.
- Leave out polite particles and words that only soften the request at the
  edges: `ค่ะ`, `คะ`, `ครับ`, `นะ`, `นะคะ`, `นะครับ`, `จ้า`, `จ๊ะ`, `เด้อ`,
  `ด้วย`, `ได้`, `ได้เลย`, `ได้มั้ย`, `ka`, `na`, `krub`. `ไม่ได้` is a
  refusal, not a softener, and stays in: `[[R:ส่งวันเสาร์ไม่ได้]]`. Leave out emoji and edge
  punctuation. `[[R:ฝากรปภ.ไว้]]ได้เลยค่ะ`, `[[R:ส่งเก็บปลายทาง]]ได้มั้ยคะ`.
- Inside brackets, the mark starts inside: `([[R:โทรก่อนส่ง]]ด้วยค่ะ [[R:หมาดุ]])`.
- A note never crosses a line break and never covers a field mark.

## Warnings

`warn:` lists, comma separated, every warning the message should raise, from
this closed set. `check.ts` derives the set from the marks, `loc:`, and the
gazetteer, and names the exact `warn:` line a record needs.

| Warning | Add it when |
|---|---|
| `ambiguous-location` | For some delivery, the administrative fields the shopper wrote (its `S`, `D`, `V`, `Z` marks) leave the route open: they fit gazetteer tuples that differ in district, province or postcode. Examples: only `[[V:ราชบุรี]]` is written; or subdistrict, district and province are written without a postcode, and that subdistrict has two postcodes. An unknown subdistrict alone is not ambiguous, because district and postcode still route the parcel. A delivery whose only administrative mark is `Z`, or that has none, needs no warning. `check.ts` decides. |
| `phone-length` | A marked phone has the wrong length for a Thai number. A mobile (`06`, `08`, `09`) needs 10 digits; any other number needs 9. Judge the gold digits, after the `+66` rule. |
| `multiple-recipients` | The message holds more than one delivery, so the record uses `loc1:`, `loc2:`. |

## Several deliveries

Some messages hold more than one delivery: two numbered orders, `ส่วนอีกที่`,
a gift for a relative next to the buyer's own address, or one person's work
and home addresses. Each delivery is a recipient.

- The header gives `loc1:`, `loc2:`, ... in the order the deliveries are
  written, and `warn:` includes `multiple-recipients`. `loc:` and `loc1:`
  never appear together, and a single delivery always uses `loc:`.
- Unnumbered marks belong to delivery 1. Marks of delivery 2 are `N2`, `P2`,
  `A2`, `S2`, `D2`, `V2`, `Z2`, and so on. `N1` is never written.
- Every delivery after the first has at least one mark.
- A name, phone, or field written once for two deliveries is marked once,
  where it is written, with the number of the delivery it is written in.
  Two deliveries for the same person (work and home) are two recipients, and
  the name is marked once.

```
===
loc1: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140
loc2: กำแพงเพชร | รัตภูมิ | สงขลา | 90180
warn: multiple-recipients
---
1. [[N:คุณวิไลพร ทองดี]] [[P:089-123-4567]] [[A:45/2 ม.3]] [[S:ต.บ่อกระดาน]] [[D:อ.ปากท่อ]] [[Z:70140]]
2. ส่งให้แม่ [[N2:คุณสมศรี ทองดี]] [[A2:12 ม.5]] [[S2:ต.กำแพงเพชร]] [[D2:อ.รัตภูมิ]] [[V2:สงขลา]] [[Z2:90180]]
```

These records never train the tagger, because the tagger reads one delivery
at a time.

## Hard rules

1. A record holds one delivery with `loc:`, or several with `loc1:`,
   `loc2:`, ... and numbered marks. Write several only for the
   `multi-recipient` category.
2. Every person, phone number, house number, company, and shop is invented.
3. Each `loc:` comes from your own sampler output. Use each location at most
   twice.
4. No two records share a skeleton. If you notice a pattern repeating a third
   time, change the layout, the order, the noise, or the persona.
5. Messages are 30 to 500 characters. Most are 60 to 250.
6. Leave realistic gaps. Many shoppers skip the subdistrict, the postcode, or
   the prefixes. Some skip the name or the phone. Do not make every record
   complete.

7. Vary who the order is for, in every category. Besides individuals, write
   orders in the name of a shop, a company or partnership, a government
   office, a school, a temple, a clinic, a club. Some of these have a contact
   person and some have no person name at all, so the organisation is `N`.
   Outside the `business` and `institution` categories, about one record in
   six should be an organisation.

## Workflow

```bash
bun scripts/chat/sample-locations.ts --pool <pool> --seed <your-seed> --n 140
# write bench/chat/sources/<pool>/<your-file>.txt
bun scripts/chat/check.ts bench/chat/sources/<pool>/<your-file>.txt --show 5
```

`check.ts` must print `"issues":0`. Fix every issue it reports, including the
`warn:` line it asks for. Then reread twenty of your own records against the
mark rules above, because the checker cannot see a wrong boundary.

Before a batch merges, `bun scripts/chat/dedup.ts` must report no cross-pool
pair. `bun scripts/chat/relabel-v2.ts <files> --write` brings a v1 file to v2
mechanically and prints counts only.

## Categories

| Category | What it holds |
|---|---|
| `person-multiline` | An individual buyer, fields on separate lines, with or without labels. The everyday case. |
| `person-oneline` | Everything on one line with no line break. Mixed field order, few separators. |
| `chat-noise` | The address sits inside a conversation: greetings, order items, sizes, payment notes, delivery instructions, emoji. |
| `form-template` | A seller's form filled in, or a format copied from a marketplace app: labels, numbered lines, `(+66)` phones, comma-separated administrative parts. |
| `business` | Companies, partnerships, shops, clinics, factories: legal forms, departments, contact persons, tax-invoice and branch notes. |
| `institution` | Schools, universities and dormitories, hospitals, government offices, temples, army camps. |
| `condo-city` | Condos, apartments, office towers, housing estates, deep soi numbering. Mostly Bangkok and the metro provinces with แขวง and เขต. |
| `rural` | Upcountry addresses: house number and หมู่ only, village names, landmarks instead of roads, no postcode memory. |
| `typos` | Misspelt administrative names and labels, tone-mark and vowel slips, keyboard slips, doubled characters, autocorrect damage. |
| `abbrev-glued` | Abbreviations without dots, missing prefixes, tokens glued without spaces, postcode glued to the province, `กทม`. |
| `english-mixed` | Romanized or English names and address details, Thai-English mixes, foreign buyers. Keep administrative names in Thai in at least four of five records. |
| `phone-numbers` | Phone format variety and number noise: `+66`, spaces, dots, Thai digits, two numbers, landlines, plus order numbers, tracking numbers, and LINE IDs that are not the phone. |
| `missing-reordered` | Fields missing or in unusual order: phone first, name last, postcode first, no subdistrict, no province, `อ.เมือง`. |
| `proxy-recipient` | Someone else receives: family, a neighbour's shop, a colleague, nicknames, Facebook or LINE display names, buyer and recipient both named. |
| `notes` | GUIDE v3. Delivery notes (`R`) inside real chat: where to leave the parcel, call first, time windows, warnings, COD and courier, and how to find the place. Half the records hold a landmark: some inside `A`, some as a sentence of its own marked `R`, a few with both. About one record in five holds no note at all, only chat that is not a note (order items, thanks, transfer done, stock questions). |

Each holdout v3 category (`bench/chat/sources/bench/<category>.v3.txt`) tests
one rule from issue #6. Every record in the file shows its category's case;
the rest of the message stays as varied as above.

| Category | What every record holds |
|---|---|
| `contact-handle` | A contact handle next to the name: `(LINE: …)`, `(ไลน์ …)`, `(IG: …)`, `(FB: …)`, `เฟส …`, `ID ไลน์ …`, `(@handle)`, bracketed or not, before or after the name. The handle is never part of `N`. |
| `name-labels` | One of: a name led by `ชื่อเล่น`, `ชื่อเล่น:`, or `ชื่อเล่นคือ`; a place-name bracket after the name (`(กทม.)`, `(บางกอก)`, `(เชียงใหม่)`); a company name written before the house number. |
| `partial-admin` | Only part of the administrative chain is written: subdistrict and postcode, district and postcode, or subdistrict and district, plus subdistrict names shared by several provinces. Some resolve to one tuple and some need `ambiguous-location`; `check.ts` says which. |
| `bangkok-shared-postcode` | A Bangkok address whose postcode is shared by several เขต, in Thai or romanized (`Bangna`, `Bang Na`, `Khlong Toei`). The เขต or แขวง is written, so the postcode alone does not decide it. |
| `phone-length` | Most records hold a phone of the wrong length as typed (9-digit mobiles, 11 or 12 digits, dashes in odd places) with `warn: phone-length`. The rest hold a valid phone next to a 13-digit tax ID, which is never marked `P`, and need no phone warning. |
| `multi-recipient` | Two or more deliveries in one message, in the [Several deliveries](#several-deliveries) format: numbered orders, `ส่วนอีกที่`, work and home of one person, a gift for family. |
