# STYLE-NOTES: how Thai shoppers really write shipping addresses in chat

A field guide for benchmark writers. Each section gives the pattern in English and short Thai
examples. **Every name, phone number, house number and village in this file is invented.**
Place names (subdistrict, district, province, postcode) are real so parsers can check them.
Where an example is *deliberately wrong* (typo, wrong order) it is marked `[wrong]`.

> About the research. Web search worked, but Thai seller-forum content (Pantip, Facebook seller
> groups, LINE OA help) was hard to reach: search returned few relevant threads and several
> help-centre pages refused automated fetches. The usable evidence came mostly from Thai
> address-parser projects (their sample inputs and preprocessing code show the noise they met in
> real messages) and from address-format references. Most patterns below come from
> knowledge of Thai online commerce, and the "What the sources did not show" section lists them.

Field names used below: **name**, **phone**, **detail** (house no., moo, village, soi, road,
building), **subdistrict**, **district**, **province**, **postcode**.

---

## 1. Message layouts

### 1.1 Multi-line, the "envelope" layout (most common for careful buyers)
Name, then address on 1 to 3 lines, then phone. Line breaks fall *between* fields but often
also in the middle of the admin part.

```
คุณวรรณา ทองสุข
88/12 ม.5 ต.คลองหนึ่ง อ.คลองหลวง
จ.ปทุมธานี 12120
โทร 089-412-7730
```
```
ธนพล แก้วใส
45 ซ.ลาดพร้าว 64 แยก 3
แขวงวังทองหลาง เขตวังทองหลาง กทม 10310
0816203347
```

### 1.2 One line, everything glued
Common from mobile users and from people copying out of notes. Fields separated by a single
space, sometimes none.

- `นายปกรณ์ ศรีสุข 0927718840 12/3 หมู่2 ต.บ้านเป็ด อ.เมือง จ.ขอนแก่น 40000`
- `ส่งที่ 77/5 ม.3 ต.หนองปรือ อ.บางละมุง ชลบุรี 20150 คุณแพร 0863310942 ค่ะ`
- `กมลชนก ใจงาม,99/41 หมู่บ้านพฤกษา 12,ต.ลาดสวาย,อ.ลำลูกกา,ปทุมธานี,12150,0953328417`

### 1.3 Seller form template, filled in by the buyer
Sellers paste a template; buyers fill it, often leaving labels, colons, empty fields, or
answering on the next line instead of after the colon.

```
ชื่อ-นามสกุล : สุดารัตน์ มีบุญ
ที่อยู่ : 15/7 ม.1 ต.ท่าทราย อ.เมือง จ.นนทบุรี
รหัสไปรษณีย์ : 11000
เบอร์โทร : 0847712093
สินค้า : เสื้อสีครีม L 2 ตัว
```
```
ชื่อผู้รับ
นุชนาถ วงศ์ดี
ที่อยู่จัดส่ง
22 ซอยวัดเทียนดัด ต.บางกรวย อ.บางกรวย นนทบุรี 11130
เบอร์ติดต่อ
081 662 0458
ช่องทางชำระ : โอน
```
Variants of labels: `ชื่อ:`, `ชื่อ-สกุล`, `ชื่อ - นามสกุล`, `ผู้รับ:`, `ที่อยู่:`, `ที่อยู่ในการจัดส่ง`,
`เบอร์:`, `เบอร์โทร.`, `เบอร์ติดต่อ`, `Tel:`, `รหัส ปณ.`, `ปณ.` Empty fields stay in: `Line ID :` with nothing after it.

### 1.4 Copied from a marketplace address book (Shopee, Lazada, TikTok Shop)
Buyers who already saved an address in an app copy it into a LINE or Facebook chat. Typical shape
(order and separators vary by app version; see "What the sources did not show"):

- `ชไมพร สายทอง | (+66) 86 551 2047`
  `199/88 หมู่บ้านเดอะซิตี้ ซอย 9, ตำบลบางพูด, อำเภอปากเกร็ด, จังหวัดนนทบุรี, 11120`
- `วีรยุทธ ศักดิ์ดี (+66)812240713 55 หมู่ 4 ตำบลศาลายา อำเภอพุทธมณฑล จังหวัดนครปฐม 73170`
- Large-to-small order, comma separated, as some app screens show it:
  `นนทบุรี, ปากเกร็ด, บางพูด, 11120` on one line and `199/88 ซอย 9` on another.
- Bilingual components: `Nonthaburi/ นนทบุรี, Pak Kret/ ปากเกร็ด, Bang Phut/ บางพูด, 11120`
- Masked phone copied from an order screen: `(+66)81*****13` (the parser must not invent digits).

### 1.5 Numbered or bulleted lists
```
1. ชื่อ รัชนี บุญมา
2. ที่อยู่ 9 ม.7 ต.ปากน้ำ อ.เมือง จ.กระบี่ 81000
3. เบอร์ 0613378821
```
```
- อรุณี พรมแดง
- 0898801126
- 31/2 ถ.รัษฎา ต.รัษฎา อ.เมือง ภูเก็ต 83000
```
Dash-prefixed lines (`\n-`) are common enough that one parser strips them explicitly.

### 1.6 Field order variations
| Order | Example |
|---|---|
| name, address, phone (default) | `ปิยะ ทองดี 9/1 ม.2 ต.ในเมือง อ.เมือง จ.อุบลราชธานี 34000 0821190345` |
| name, phone, address | `ปิยะ ทองดี 0821190345 9/1 ม.2 ต.ในเมือง อ.เมือง อุบล 34000` |
| phone first | `0821190345 ปิยะ 9/1 ม.2 ต.ในเมือง อ.เมืองอุบลฯ 34000` |
| address first, name at end | `9/1 ม.2 ต.ในเมือง อ.เมือง จ.อุบลราชธานี 34000 ผู้รับ ปิยะ ทองดี โทร 0821190345` |
| postcode before province | `ต.ในเมือง อ.เมือง 34000 อุบลราชธานี` |

Also seen: the name split from its surname by the phone (`ปิยะ 0821190345 ทองดี`) when buyers edit
an old message.

### 1.7 Split across several chat bubbles
Benchmark records can join bubbles with `\n`. Buyers send name, then address, then "อ้อ เบอร์
0634420981 นะคะ" a minute later.

---

## 2. Chat noise around the address

### 2.1 Openers and lead-ins
`สวัสดีค่ะ`, `แอดคะ`, `ขอสั่งค่ะ`, `ส่งที่`, `ส่งมาที่`, `ส่งของที่`, `ที่อยู่ค่ะ`, `ที่อยู่จ้า`,
`ที่อยู่นะครับ 👇`, `ตามนี้เลยค่ะ`, `จัดส่ง`, `ชื่อผู้รับ`. Misspelled lead-ins occur too: `ที้อยุ่`,
`ชือ.` (both are stripped explicitly in an open-source parser's preprocessing).

- `สวัสดีค่ะแอด ส่งที่นี่นะคะ 🙏 ...`
- `ที่อยู่จ้า\nมยุรี ...`
- `ok ค่ะ ส่งมาที่ ...`

### 2.2 Particles glued to fields
Particles stick to the last word of a field, which damages tokenisation:
- `จ.ลำปางค่ะ`, `52000ค่ะ`, `0897713302นะคะ`, `คุณเอ๋ครับ`
- `ส่งปทุมจ้า`, `เขตบางกะปิน้า`, `เบอร์นี้เลยค้าบ 0851102236`

### 2.3 Order details mixed in (before, after, or between fields)
- `เอาสีดำ size M 2 ตัว ส่งที่ ...`
- `ครีมกันแดด 3 หลอด + สบู่ 1 ก้อน รวม 890 ค่ะ`
- `รหัสสินค้า A12 สีชมพู` (product codes look like house numbers)
- `CF 3 ชิ้น` (CF = confirm, from live-selling comment culture)

### 2.4 Payment notes
`โอนแล้วค่ะ`, `โอนแล้วนะคะ สลิปตามรูป`, `แนบสลิปแล้ว`, `COD`, `เก็บปลายทาง`, `ปลายทางค่ะ`,
`เก็บเงินปลายทาง 590`, `โอน 450 บาท 14.32 น.` (times and amounts are numbers near the address).

### 2.5 Delivery instructions
- `โทรก่อนส่งด้วยนะคะ`, `ถึงแล้วโทรหาค่ะ`, `ฝากไว้ที่ป้อมยาม`, `ฝากนิติ`, `ฝากรปภ.`,
  `วางไว้หน้าบ้านได้เลย`, `ส่งช่วงเย็นหลัง 5 โมง`, `วันเสาร์ไม่อยู่`, `ห้ามส่ง Flash นะคะ`,
  `ขอส่ง Kerry`, `ส่งไปรษณีย์ EMS`, `ฝากไว้ร้านข้าวมันไก่หน้าซอย`.
- These often sit between the address detail and the subdistrict:
  `55/3 ม.6 (ถึงแล้วโทรนะคะ) ต.สุเทพ อ.เมือง เชียงใหม่ 50200`

### 2.6 Emoji, sticker text, decoration
`🙏`, `😊`, `❤️`, `📍` before the address, `📞` or `☎️` before the phone, `🏠`, `👇👇`.
Sticker placeholders appear when chat logs are exported: `[สติกเกอร์]`, `[Sticker]`, `[รูปภาพ]`.
Decorative separators: `-----`, `=====`, `•`, `✨`.

- `📍 12/8 ซ.พหลโยธิน 48 แขวงอนุสาวรีย์ เขตบางเขน กทม 10220`
- `📞 087-660-1948 ✨`

### 2.7 Corrections and edits
- `แก้เบอร์เป็น 0912236654 นะคะ`
- `ขอโทษค่ะ บ้านเลขที่ 18 ไม่ใช่ 81`
- `เปลี่ยนที่อยู่ค่ะ ส่งที่ทำงานแทน ...`
- `*ม.4 ค่ะ พิมพ์ผิด` (asterisk correction, LINE style)
A record with an edit has two candidate values; the later one wins.

---

## 3. Recipient styles

### 3.1 Individuals
- With honorific: `นาย`, `นาง`, `นางสาว`, `น.ส.`, `นส.`, `ด.ช.`, `ด.ญ.`, `คุณ`, `K.` (`K.ต้น`),
  rank or title: `ร.ต.อ.`, `จ.ส.อ.`, `ดร.`, `ผศ.ดร.`, `พระมหา`, `แม่ชี`.
  - `น.ส.ศิริพร ดวงแก้ว`, `คุณ อัมพร`, `จ.ส.อ.ชาตรี มั่นคง`
- Without honorific, sometimes first name only: `ต่าย`, `เจ๊หมวย`, `พี่โอ๊ต`.
- Nickname in brackets: `จิราพร สุขใจ (ฝน)`, `วิทยา (เบียร์) ปานทอง`, `ฝน จิราพร`.
- Name in English or romanised: `Kittipong S.`, `PIMCHANOK R.`, `Nong May`.
- Foreigners: `Mr. Daniel Hartmann`, `Ms. Yuki Tanaka`, `John (คุณจอห์น)`, `Li Wei / หลี่ เว่ย`.
- Facebook or LINE display name instead of a legal name: `Nampueng Shop'z`, `แม่น้องปุยฝ้าย`,
  `Kwan 🌸`, `ป้าแดง ขายส่ง`.

### 3.2 Proxies and c/o
- `ฝากส่งให้แม่นะคะ ชื่อ นางบุญมี แสงทอง`
- `ผู้รับแทน: สมพงษ์ (สามี)`, `ส่งในชื่อ ลูกสาว ด.ญ.ปริม`
- `c/o คุณเอก`, `ฝาก คุณนิด ร้านขายของชำ`, `รับแทน รปภ.`
- Two names: `ผู้สั่ง เมย์ / ผู้รับ ป้าจันทร์` (only the receiver is the recipient field).

### 3.3 Shops and companies
- `ร้านบุญเจริญการค้า`, `ร้านเฮียเส็งวัสดุ`, `ร้านกาแฟบ้านสวน`
- `บริษัท สยามพัฒน์ซัพพลาย จำกัด`, `บจก. ไทยรุ่งโลจิส`, `บริษัท ทีพีเอ็น เทรดดิ้ง จำกัด (มหาชน)`,
  `บมจ.`, `หจก.ศรีสวัสดิ์ก่อสร้าง`, `ห้างหุ้นส่วนจำกัด`, `Co., Ltd.`, `คลินิกทันตกรรมยิ้มสวย`,
  `สำนักงานบัญชีพรเพ็ญ`.
- Department and contact: `ฝ่ายจัดซื้อ`, `ฝ่ายบุคคล`, `แผนก IT`, `attn. คุณจันทร์เพ็ญ`,
  `ติดต่อ คุณวิไล (บัญชี)`.

```
บจก. รุ่งทวีอินเตอร์
ฝ่ายจัดซื้อ attn. คุณศศิธร
เลขที่ 300/14 นิคมอุตสาหกรรมอมตะซิตี้ ต.บ่อวิน อ.ศรีราชา ชลบุรี 20230
โทร 038-110-245 ต่อ 112
```

### 3.4 Tax-invoice requests
The buyer sends *two* addresses: billing for the invoice and shipping. Tax ID is 13 digits.
```
ขอใบกำกับภาษีเต็มรูปค่ะ
บริษัท พรีม่าฟู้ด จำกัด (สำนักงานใหญ่)
เลขผู้เสียภาษี 0105561123457
ที่อยู่ตามภพ.20: 41 ถ.รามอินทรา แขวงอนุสาวรีย์ เขตบางเขน กทม. 10220
ส่งของที่: โกดัง 9/9 ม.2 ต.บางเมือง อ.เมืองสมุทรปราการ 10270 คุณต้น 0819020034
```
Also `สาขาที่ 00002`, `สาขา 0003`, `HQ`, `สนญ.`.

### 3.5 Institutions
- School: `โรงเรียนบ้านหนองแวง (ครูสมศรี) ต.หมากแข้ง อ.เมือง อุดร 41000`
- Hospital: `รพ.หาดใหญ่ ตึกอายุรกรรม ชั้น 4 พยาบาลจิรา ต.หาดใหญ่ อ.หาดใหญ่ สงขลา 90110`
- Government: `สำนักงานเขตจตุจักร ฝ่ายทะเบียน`, `อบต.`, `เทศบาลตำบล...`, `ที่ว่าการอำเภอ...`
- Temple: `วัดป่าศรีมงคล ถวายพระครู...`, `พระอาจารย์ (ชื่อ) วัด...`
- Army or police: `ค่ายสุรนารี ร.3 พัน.1 ร้อย.2`, `กองร้อย ตชด.`, `บก.ทท.`
- Dormitory: `หอพักบ้านเพื่อน ห้อง 314`, `หอใน ม.ขอนแก่น หอ 26 ห้อง 512`
- University faculty: `คณะวิศวกรรมศาสตร์ ภาควิชาเคมี ชั้น 3 มหาวิทยาลัย...`

---

## 4. Address detail styles

### 4.1 House number
`บ้านเลขที่ 12`, `เลขที่ 12`, `12`, `12/3`, `12/345`, `12-13` (two plots), `123/4-5`, `บ้านเลขที่ ๑๒`,
`เลขที่12/3` (glued). House numbers with slashes look like dates (`12/3` vs 12 March).

### 4.2 หมู่ (moo, village group)
Variants: `หมู่ 5`, `หมู่ที่ 5`, `ม.5`, `ม. 5`, `ม5`, `ม 5`, `หมู่5`, `มู่ 5` [typo], `Moo 5`, `M.5`,
`Mu 5`, `ม.๕`. It often glues to the house number: `12ม.5`, `12/3หมู่5`.
- `45 ม.2 บ้านโนนสูง ต.ในเมือง ...`
- `บ้านเลขที่ 7 หมู่ที่ 11 บ้านหนองบัว`
Danger: `ม.` also abbreviates มหาวิทยาลัย (`ม.เกษตร`) and in `ม.ค.` (January).

### 4.3 หมู่บ้าน (housing estate) and village names
`หมู่บ้านพฤกษา 9`, `มบ.เพอร์เฟค พาร์ค`, `ม.บ้านชัยพฤกษ์`, `บ้านหนองแวง` (rural village, บ้าน as
a prefix, not a house), `โครงการ`, `Village`.
- `99/123 มบ.ศุภาลัยวิลล์ ซ.5 ต.บางพูด อ.ปากเกร็ด นนท 11120`

### 4.4 ซอย and sub-soi
`ซอย`, `ซ.`, `ซ`, `soi`, `Soi`. Numbering: `ซ.สุขุมวิท 101/1`, `ซ.ลาดพร้าว 64 แยก 3`, `ซอย 5 แยก 2-4`,
`ซ.วัดเทียนดัด`, `ซ.อ่อนนุช 17 แยก 10-2`, `ซอยเพชรเกษม 69/1`.
Named soi with the road name implied: `ซ.รามคำแหง 24` (road not written).

### 4.5 ถนน
`ถนน`, `ถ.`, `ถ`, `Rd.`, `Road`, `ถนนใหญ่` (meaning main road), `ติดถนน`. Long road names with
numbers: `ถ.พุทธมณฑลสาย 4`, `ถ.เพชรเกษม กม.25`, `ถนนสาย 4029`.

### 4.6 Condos, apartments, offices
- `ลุมพินีวิลล์ อาคาร B ชั้น 12 ห้อง 1205`, `คอนโด The Base ตึก A 8/77`, `อาคาร C ห้อง 4/219`
- `ห้อง 507 ชั้น 5 อพาร์ทเม้นท์ ... ` (spelled `อพาร์ตเมนต์`, `อพาร์ทเม้น`, `apartment`)
- `ตึกจามจุรี 5 ชั้น 14 ห้อง 1402`, `FL.23 Unit 2301`, `#1205`, `Rm. 312`
Room numbers look like house numbers. Buildings often precede the house number.

### 4.7 Landmarks and directions
`ตรงข้ามเซเว่น`, `ใกล้วัดบางพลีใหญ่`, `หลังตลาดสด`, `ข้างปั๊ม ปตท.`, `เยื้องโรงเรียน`,
`ซอยติดร้านยาง`, `บ้านสีฟ้าหลังที่ 3`, `ปากซอยมีร้านส้มตำ`, `เลยสามแยกไปนิด`.
- `บ้านเลขที่ 3 ม.8 (หลังวัดโพธิ์ทอง) ต.ท่าข้าม ...`

### 4.8 Rural addresses with very little detail
Only house number, moo and village, sometimes not even a house number:
- `บ้านนายสมาน ม.6 บ้านดอนแดง ต.... อ.... ร้อยเอ็ด 45000`
- `ม.3 บ้านห้วยทราย ฝากผู้ใหญ่บ้าน`
- `บ้านเลขที่ 4 หมู่ 9` then the admin part.

### 4.9 Markets, stalls, factories, estates
- `ตลาดไท แผง C-23 ร้านเจ๊ใหญ่`, `ตลาดสี่มุมเมือง ล็อค 145`, `จตุจักร โครงการ 2 ซอย 3 ห้อง 112`
- `โรงงาน ... นิคมอุตสาหกรรมบางปู ซ.9`, `สวนอุตสาหกรรมโรจนะ`, `อมตะนคร`, `เขตประกอบการ...`
- `โกดังเลขที่ 4`, `คลังสินค้า B2`

### 4.10 PO boxes, pickup points, lockers
- `ตู้ ปณ. 45 ปณ.หาดใหญ่ 90110`, `ตู้ไปรษณีย์ 12`, `P.O. Box 88`, `ปณ.ลาดพร้าว`
- `รับที่ไปรษณีย์ ... (ไม่ต้องส่งบ้าน)`, `ส่งแบบรับที่สาขา Kerry ...`,
  `ส่ง 7-Eleven สาขา ... (ส่งถึงเซเว่น)`, `ตู้ล็อกเกอร์ ...`, `ฝากร้าน Flash หน้าปากซอย`
These have no house number; the "detail" is the box or branch.

---

## 5. Administrative part

### 5.1 Prefix variants
| Level | Prefixes seen |
|---|---|
| subdistrict | `ตำบล`, `ต.`, `ต`, `ต .`, `ตฺ` (phinthu instead of dot, a keyboard slip), `แขวง`, `ข.`, `Tambon`, `T.` |
| district | `อำเภอ`, `อ.`, `อ`, `เขต`, `ข.`, `Amphoe`, `Amphur`, `A.`, `Khet` |
| province | `จังหวัด`, `จ.`, `จ`, `จว.`, `Changwat`, none at all (most common) |

- `ต.บ้านสวน อ.เมือง จ.ชลบุรี 20000`
- `ตำบล บ้านสวน อำเภอ เมืองชลบุรี จังหวัด ชลบุรี 20000`
- `ตบ้านสวน อเมือง จชลบุรี 20000`
- `บ้านสวน เมือง ชลบุรี 20000` (no prefixes at all)

### 5.2 Glued, spaced, and split
- Glued: `ต.บ้านสวนอ.เมืองจ.ชลบุรี20000`
- Extra space inside a name: `ต.บ้าน สวน`, `เชียง ใหม่`, `กรุงเทพ มหานคร`
- Line break inside: `ต.บ้าน\nสวน`, `อ.เมือง\nชลบุรี` (district name ends up looking like a province)

### 5.3 อ.เมือง short form
Every province has an อำเภอเมือง; people drop the province part: `อ.เมือง`, `อ.เมืองฯ`,
`เมืองเชียงใหม่`, `อ.เมืองเชียงใหม่`, `อ.เมือง จ.เชียงใหม่`, `อำเภอเมืองฯ`.
Exception to watch: อยุธยา's capital district is `อ.พระนครศรีอยุธยา`, not "เมือง", yet people
still write `อ.เมือง อยุธยา`.

### 5.4 Bangkok
- Province: `กรุงเทพมหานคร`, `กรุงเทพฯ`, `กรุงเทพ`, `กทม`, `กทม.`, `กท.`, `กรุงเทพมหานคร.`,
  `Bangkok`, `BKK`, `bkk`, `Bkk.`, `กรุงเทพ ฯ`. Often omitted entirely when `เขต` is present.
- Districts: `เขตจตุจักร`, `จตุจักร`, `ข.จตุจักร`, `เขต จัตุจักร` (variant spelling).
- People mix rural prefixes into Bangkok: `ต.ลาดยาว อ.จตุจักร กทม 10900` [wrong prefixes, real address].
- Renamed or split subdistricts: some buyers still write old names (e.g. `แขวงบางนา` after the
  district's subdistricts were split into บางนาเหนือ and บางนาใต้). Keep a few of these.
- `แขวงห้วยขวาง เขตห้วยขวาง` (same name twice is normal, not a duplicate error).

### 5.5 Province short names and nicknames
| Written | Official |
|---|---|
| `โคราช`, `นครราชสีมาฯ`, `เมืองย่า` | นครราชสีมา |
| `อยุธยา`, `กรุงเก่า` | พระนครศรีอยุธยา |
| `แปดริ้ว` | ฉะเชิงเทรา |
| `ปากน้ำ` | สมุทรปราการ |
| `มหาชัย` | สมุทรสาคร |
| `แม่กลอง` | สมุทรสงคราม |
| `เมืองนนท์`, `นนท์`, `นนท` | นนทบุรี |
| `ปทุม` | ปทุมธานี |
| `สุพรรณ` | สุพรรณบุรี |
| `กาญ`, `กาญจน์`, `เมืองกาญจน์` | กาญจนบุรี |
| `อุบล`, `อุบลฯ`, `อุดร`, `อุดรฯ` | อุบลราชธานี, อุดรธานี |
| `นครศรี`, `นครศรีฯ`, `นคร` | นครศรีธรรมราช |
| `สุราษ`, `สุราษฎร์` | สุราษฎร์ธานี |
| `ประจวบ`, `ประจวบฯ` | ประจวบคีรีขันธ์ |
| `หาดใหญ่` (written in the province slot) | actually a district of สงขลา |
| `พัทยา`, `บางแสน`, `ศรีราชา` (as if province) | districts or towns in ชลบุรี |

- `12 ม.3 ต.หน้าเมือง อ.เมือง แปดริ้ว 24000`
- `ส่งโคราชค่ะ 30000 ต.ในเมือง`

### 5.6 Omissions
- No subdistrict: `99 ม.4 อ.คลองหลวง ปทุมธานี 12120`
- No district: `ต.ศาลายา นครปฐม 73170`
- No postcode: `ต.สุเทพ อ.เมือง จ.เชียงใหม่` (buyer expects the seller to look it up)
- No province, postcode only: `ต.หนองปรือ อ.บางละมุง 20150`
- Only postcode and district: `ปากเกร็ด 11120`

### 5.7 Wrong order and wrong postcode
- Province before district: `จ.ขอนแก่น อ.เมือง ต.บ้านเป็ด 40000`
- Postcode in the middle: `ต.บ้านเป็ด 40000 อ.เมือง ขอนแก่น`
- Postcode from the main district office when the subdistrict has its own [wrong, common].
- Postcode with 4 digits or a stray digit: `4000`, `400000`, `40 000` [wrong].

### 5.8 Postcode glued to province or phone
`ชลบุรี20000`, `จ.ลำปาง52000ค่ะ`, `2000008912345678` (postcode and phone with no separator), `กทม10310`.

### 5.9 Thai digits
`๑๒/๓ ม.๕ ต.บางพูด อ.ปากเกร็ด นนทบุรี ๑๑๑๒๐`, phones `๐๘๑-๒๓๔-๕๖๗๘`, mixed `12/๓`.
Mostly from older buyers, official letterheads, or copied from government documents.

### 5.10 Romanised place names
`Tambon Ban Suan, Amphoe Mueang, Chonburi 20000`, `T.Suthep A.Muang Chiang Mai 50200`,
`Bang Phut, Pak Kret, Nonthaburi`, `Khlong Toei Nuea, Watthana, Bangkok 10110`.
Spellings vary: `Muang`/`Mueang`, `Chonburi`/`Chon Buri`, `Khlong`/`Klong`, `Nuea`/`Nua`,
`Pathum Thani`/`Pathumthani`. Foreign buyers mix scripts: `condo Lumpini Ramkhamhaeng 24 แขวงหัวหมาก`.

---

## 6. Mistakes people really make

### 6.1 Province, district and subdistrict misspellings
| Written [wrong] | Correct | Kind of slip |
|---|---|---|
| `ศรีษะเกษ` | ศรีสะเกษ | conflation with ศีรษะ |
| `หนองบัวลำพู` | หนองบัวลำภู | ภ/พ |
| `สุราษฏร์ธานี`, `สุราษร์ธานี` | สุราษฎร์ธานี | ฎ/ฏ, missing letter |
| `บุรีรัม`, `สุรินท`, `เพชรบูรณ` | บุรีรัมย์, สุรินทร์, เพชรบูรณ์ | missing ์ and its carrier |
| `กาฬสินธ์`, `กาลสิน` | กาฬสินธุ์ | vowel and letter slips |
| `ชะเชิงเทรา`, `ฉะเชิงเทลา` | ฉะเชิงเทรา | ฉ/ช, ร/ล |
| `สมุทปราการ`, `สมุทรปรากาน` | สมุทรปราการ | dropped ร, ร/น |
| `นครราชศรีมา` | นครราชสีมา | ส/ศ |
| `พิศณุโลก` | พิษณุโลก | ษ/ศ |
| `กาญจณบุรี` | กาญจนบุรี | ณ/น |
| `ไชยภูมิ` | ชัยภูมิ | ไช/ชัย |
| `พระนครศรีอยุทธยา` | พระนครศรีอยุธยา | extra ท |
| `กรุงเทพมหานค`, `กรุงเทถมหานคร` | กรุงเทพมหานคร | dropped letter, พ/ถ adjacent key |
| `คอหงส์` | คอหงษ์ | ส/ษ (a real parser hard-codes this fix) |
| `ราชบูรณะ` | ราษฎร์บูรณะ | sound spelling |
| `ภาษีเจิญ`, `ลาดกระบัญ` | ภาษีเจริญ, ลาดกระบัง | dropped ร, ญ/ง |

### 6.2 Tone-mark and vowel slips
- Missing tone: `บานเลขที่`, `หมุ 3`, `ทีอยู่`. Extra or doubled tone: `ที่่อยู่`, `หมู่่`.
- Wrong tone: `ที้อยุ่` (seen in a real parser's cleanup list), `ซ้อย`, `ขอนแก้น`.
- Vowel swaps: `ขอนแกน`, `เชียงไหม่`, `อุดรธานิ`, `ปทุมทานี`.

### 6.3 Keyboard-layout slips (Kedmanee layout)
- Forgot to switch to Thai, typed on the English layer: `dm,` = กทม, `[hko` = บ้าน,
  `mujvp^j` ≈ ที่อยู่.
- Digits typed on the Thai layer: `จคๅ/-ภถุึค` = 0812345678 (จ=0, ค=8, ๅ=1, /=2, -=3, ภ=4, ถ=5, ุ=6, ึ=7).
- Adjacent-key hits: `ที่ชยู่` for ที่อยู่, `หมู่ทตี่` for หมู่ที่, `จ.เชียงรเาย` for เชียงราย,
  `ต.อดงัะดะ` (garbled subdistrict). Examples in this style are used as tests by a Thai
  address spell-correction library.
- `c.` for `จ.` and `ตฺ` for `ต.` (the dot key is on a shifted position in Thai).

### 6.4 ร/ล and other sound-based swaps
`ปากเกล็ด` (ปากเกร็ด), `ลาดพล้าว` (ลาดพร้าว), `ล่มเกล้า` (ร่มเกล้า), `ลามคำแหง` (รามคำแหง),
`ศรีนครินท์`/`ศรีนคริน` (ศรีนครินทร์), `บางพลัด` vs `บางพลี` confusions, ส/ศ/ษ swaps, ท/ธ swaps
(`ธัญญบุรี`, `ทัญบุรี` for ธัญบุรี).

### 6.5 Duplicated characters, autocorrect, labels
- Doubled letters or digits: `กรุงเทพพ`, `ม.55` (meant ม.5), `0899123345566` (too long).
- Autocorrect from English keyboards on romanised text: `Moo` -> `Moon`, `Soi` -> `Sol`,
  `Khet` -> `Kher`, `Amphoe` -> `Amphibian` [rare but funny].
- Typos in labels: `ที่อยุ่`, `ที่อยู`, `ชือ`, `เบอ`, `เบอร์โท`, `รหัสไปรษณี`, `อำเภ`, `จังหวด`.

### 6.6 Spaces, breaks and punctuation
- No spaces: `12/3ม.5ต.บางพูดอ.ปากเกร็ดนนทบุรี11120`
- Too many: `ต .  บางพูด    อ .ปากเกร็ด`
- Stray punctuation: `ต.,บางพูด`, `อ.ปากเกร็ด..`, `นนทบุรี,,11120`, `(11120)`, `"0812..."`,
  quotes and brackets around fields (one parser strips `(`, `)` and `"` before parsing).
- Colon spacing: `เบอร์:081...`, `เบอร์ : 081...`, `เบอร์ ：081...` (full-width colon).
- Zero-width characters and non-breaking spaces from copied text (invisible but real).

---

## 7. Phone formats

### 7.1 Mobile numbers (10 digits, start 06, 08, 09)
`0812345678`, `081-234-5678`, `081 234 5678`, `08-1234-5678`, `0812-345-678`, `081.234.5678`,
`081-2345678`, `(081) 234 5678`.
Invented examples: `0937741025`, `086 220 1974`, `09-5518-2630`.

### 7.2 International forms
`+66812345678`, `+66 81 234 5678`, `(+66) 81 234 5678`, `(+66)812345678`, `66812345678`,
`+66-81-234-5678`, `+660812345678` [wrong but common: keeps the leading 0].

### 7.3 Thai digits and mixed digits
`๐๘๑๒๓๔๕๖๗๘`, `๐๘๑-๒๓๔-๕๖๗๘`, `08๑-234-5678` (mixed, from switching keyboards mid-number).

### 7.4 Landlines and extensions
Bangkok `02` + 7 digits: `02-123-4567`, `02 1234567`, `0-2123-4567`.
Provincial 3-digit area codes + 6 digits: `053-123-456` (เชียงใหม่), `038-123-456` (ชลบุรี),
`074-123-456` (สงขลา), `044-123-456` (นครราชสีมา).
Extensions: `ต่อ 112`, `ext. 112`, `#112`, `กด 2`.

### 7.5 Two numbers, labels and splitting
- `โทร 0813345021, 0924410078`, `0813345021 / 0924410078`, `เบอร์สำรอง 0924410078`
- Labels: `โทร`, `โทร.`, `เบอร์`, `เบอร์โทร`, `มือถือ`, `มท.`, `tel`, `Tel.`, `T.`, `M.`, `📞`, `☎`.
- Owner notes: `0864491120 (ลูกชาย)`, `ถ้าไม่รับโทร 0864491120 แฟน`.
- Number broken by a line break: `081-234-\n5678`.
- Too short or too long by one digit (the buyer mistyped): `081234567`, `08123456789` [wrong].

### 7.6 Numbers that look like phones but are not
| Lookalike | Example (invented) | How it differs |
|---|---|---|
| Tax ID | `0105561123457` | 13 digits, often labelled เลขผู้เสียภาษี |
| National ID | `1-1007-01234-56-7` | 13 digits, 1-4-5-2-1 dashes |
| Bank account | `กสิกร 123-4-56789-0`, `ไทยพาณิชย์ 4071234567` | 10 digits, bank name nearby |
| PromptPay | `พร้อมเพย์ 0812345678` | is a phone, but not the delivery phone |
| Order number | `#2408151234567`, `Order 240815ABCD12` | marketplace prefixes |
| Tracking number | `TH0123456789A`, `KEX1234567890`, `JT1234567890`, `SPXTH012345678901`, `EF123456789TH` | letter prefix or suffix |
| LINE ID | `@shopname`, `id: may0812`, `line 0891234567` (LINE ID that is a phone) | label line/ไลน์ |
| Amount or date | `1,290`, `15/08/68`, `14.32 น.` | separators, unit |
| Postcode + house no. | `11120 99/1` | 5 digits then slash |

---

## Sources

URLs actually read during research (fetched and used):

- https://github.com/425degree-developers/thaiaddress (README, `thaiaddress/parser.py`, `thaiaddress/utils.py` via the GitHub API). Sample one-line input with name, phone, `ถ.`, `ต. ` with a space, `อ.`, `จ.`; tag set NAME/ADDR/LOC/POST/PHONE/EMAIL; preprocessing that strips `ส่ง`, `จัดส่ง`, `ชือ.`, `ผู้รับ`, `ส่งที่`, `ที่อยู่`, `ที้อยุ่`, `ที่อยู่จ้า`, `ส่งของที่`, `ส่งมาที่`, `\n-`, brackets, quotes, emoji; fixes for `ตฺ`, `คอหงส์`, `กทม`.
- https://github.com/thirawat69/PyThaiAddr (README via the GitHub API). Typo test strings: `ที่ชยู่`, `หมู่ทตี่`, `ต.อดงัะดะ`, `อ.ยแม่ลาว`, `จ.เชียงรเาย`, `c.กรุงเทถมหานค`, `ที่อยูล่`, `หมูี่ที่`, `แขวงพระบรมถหาราชวัง`, a 4-digit postcode.
- https://pypi.org/project/ThaiAddressParser/ . Sample input with misspelled subdistrict (`ต.ม.ก่องคร`), `อ.เมืองสมุทรสงคราม`, a stray number, and province after district.
- https://claudskills.com/skills/thai-address/SKILL.md . Small-to-large order, `ต. อ. จ. ซ. ถ. ม.` abbreviations, แขวง/เขต for Bangkok, building/floor/room before the house number.
- https://www.smarty.com/global-address-formatting/thailand-address-format-examples . Romanised layouts, PO box form `G.P.O. Box`, note that romanisation is transliteration, shared abbreviation "BK".
- https://janio.asia/resources/articles/last-mile-e-commerce-fulfillment-challenges-in-thailand (read; no usable address detail).

Search-result snippets also informed a few points (not fully read): ExpatFocus on rural addresses
without road names and on PO boxes; FlowAccount and the Revenue Department on tax-invoice fields;
ZORT seller docs on returned-parcel costs; Google Forms order templates (fields ชื่อ-นามสกุล,
เบอร์โทร, ที่อยู่ในการจัดส่ง, Line ID, จำนวน).
Fetch failed: npmjs.com (`thai-address-cut`, 403), pypi.org `thaiaddress` and `thaiaddressclean`
(page did not render), help.shopline.com (403). No Pantip thread on the topic was found.

## What the sources did not show

These patterns come from general knowledge of Thai online selling, not from a page read above.
Treat them as plausible and vary them, but do not over-weight any one:

- Exact Shopee, Lazada and TikTok Shop copy formats (`|` separator, `(+66)` with spaces, masked
  phones, bilingual `Province/ จังหวัด` components, large-to-small comma order). App layouts change
  between versions; write several shapes.
- All chat-noise phrases in section 2 other than the lead-ins quoted from the parser code
  (payment notes, delivery instructions, CF, sticker placeholders, edits).
- Recipient styles in section 3: honorific and rank abbreviations, proxies, company forms,
  attn./ฝ่ายจัดซื้อ, branch codes on tax invoices, institution formats (army units, dorms, temples).
- Condo, market-stall, industrial-estate, locker and 7-Eleven pickup formats.
- Province nicknames table and the อยุธยา "อ.เมือง" exception.
- The Bangkok subdistrict renaming example and mixing ต./อ. into Bangkok addresses.
- The misspelling table in 6.1 beyond `คอหงส์` and `กรุงเทถมหานค`, the ร/ล list, autocorrect damage,
  zero-width characters and full-width colons.
- The Kedmanee layout mappings in 6.3 (derived from the standard layout, not from a source).
- All phone formats and lookalike formats in section 7 (tracking prefixes, PromptPay, ID layouts).
