# Reviewer brief

Project goal: a large, categorized set of Thai shipping-address chat messages
is used to test and improve a small Thai address parser until it is over 95%
accurate. Writers produced the files under `bench/chat/sources/`. Their marks
are the answer key. Several writers worked before `bench/chat/GUIDE.md`
reached its final wording, so they resolved unclear rules in different ways.
You bring one file into line with the final GUIDE.

Your prompt gives you FILE. Run every command from the repository root.

1. Read `bench/chat/GUIDE.md` in full. Its mark rules are final.
2. Read every record in FILE. For each one, decide what a careful person
   following GUIDE.md would mark, and compare with the marks in the file.
3. Fix the marks where they differ. Change the message text only when the
   message itself breaks a hard rule or cannot be marked without ambiguity,
   and then change as little as possible. Never change a `loc:` line.
4. Run `bun scripts/chat/check.ts FILE` and fix until it prints `"issues":0`.
   The record count must not drop.

Check these in every record, because writers disagreed on them:

- `N` holds the recipient only. Label words stay out. Honorifics, kinship and
  call words joined to the name, and brackets right after the name stay in.
  Brackets that hold address detail are `A` instead, and brackets that hold a
  remark to the seller are unmarked.
- An organisation and a person on the same line with only spaces, brackets, or
  a slash between them are one `N`, in either order. Written apart (another
  line, or a label such as `ติดต่อ` or `attn.` between them), the person is
  `N` and the organisation goes in `A`. With no person, the organisation is
  `N`. Brackets right after the organisation stay one `N` even when
  they start with such a label: `[[N:บจก.เอบีซี (attn. คุณบี)]]`.
- `P` is the recipient's number, not the buyer's. With a correction, it is the
  corrected number. Otherwise the first number.
- `บ้านเลขที่` and `เลขที่` are inside `A`. `ที่อยู่`, `ส่งที่` and similar labels
  are outside.
- A landmark that says where the place is belongs in `A`. An instruction to the
  courier does not.
- Every piece of address detail is marked, including a piece that comes after
  the administrative names or after the phone.
- An administrative name the shopper wrote is marked `S`, `D`, or `V`, even
  when misspelt, shortened, or romanized. A place name inside an organisation,
  road, or village name is not.
- No mark starts or ends with a space or with edge punctuation that is not
  part of the field.

Fences. Edit only FILE. Do not read other files under `bench/chat/sources/`.
Do not edit code, GUIDE.md, or the briefs. Run no git commands.

Final reply, eight lines at most: how many records you changed, a count per
rule above, the JSON line `check.ts` printed, and any case GUIDE.md still does
not settle, with the record's first line.
