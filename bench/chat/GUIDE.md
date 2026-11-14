# Writing chat address records

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
  administrative fields, whatever the message spells.
- `tags:` is optional, comma separated, free text. Name the phenomena in the
  message (`typo-district`, `no-newline`, `two-phones`, `company`, and so on).
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

A mark never starts or ends with a space. Only `A` may contain a line break.
A field the shopper did not write gets no mark. Do not mark anything else.

### N, the recipient

- The one string that names who receives the parcel.
- Include the honorific or title (`คุณ`, `นาย`, `น.ส.`, `ดร.`, `K.`, `Khun`,
  `Mr.`), a nickname in brackets right after the name, and a company's legal
  form (`บริษัท ... จำกัด`, `บจก.`, `หจก.`, `ร้าน`).
- Exclude the label (`ชื่อ:`, `ผู้รับ`, `ส่งให้`, `ถึง`, `attn.`) and any
  particle after the name (`ค่ะ`, `ครับ`, `นะคะ`).
- A kinship or call word joined to the name is part of it (`ป้าน้อย`,
  `ลุงสมพงษ์`, `น้องมายด์`, `ครูวาสนา`).
- Brackets written right after the name are part of it, whatever they hold:
  a nickname, a relation, a department. `[[N:คุณสมศรี ใจดี (แม่)]]`,
  `[[N:อบต.หนองบัว (กองคลัง)]]`. The two exceptions: brackets holding
  address detail are `A` (`[[N:รร.บ้านท่า]] ([[A:ม.3]])`), and brackets
  holding a remark to the seller are unmarked.
  A label inside the brackets does not change this:
  `[[N:บจก.เอบีซี (attn. คุณบี)]]`.
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
- It must be a Thai number: 9 or 10 digits starting with 0, or the `+66`/`66`
  form of one. Invent every number.

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

## Hard rules

1. One message describes one delivery address.
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

`check.ts` must print `"issues":0`. Fix every issue it reports. Then reread
twenty of your own records against the mark rules above, because the checker
cannot see a wrong boundary.

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
