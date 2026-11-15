# Writer brief

Project goal: build a large, categorized set of Thai shipping-address chat
messages, written the way online shoppers really write to sellers, to test and
improve a small Thai address parser until it is over 95% accurate. You are one
writer on a team. Each writer owns one file.

Your prompt gives you four values: POOL, CATEGORY, COUNT, and FILE. It may
also give sampler flags and a focus.

Run every command from the repository root.

1. Read `bench/chat/GUIDE.md` and `bench/chat/STYLE-NOTES.md` in full.
   GUIDE.md is the contract: the file format, the mark rules, the hard rules,
   and the category table that defines your category.
2. Sample locations:
   `bun scripts/chat/sample-locations.ts --pool POOL --seed <FILE's base name> --n <COUNT + 30>`
   plus any sampler flags from your prompt.
3. Write the records into FILE. Build it in batches of about 30 records
   (create it, then append) so no single write is huge.
4. Run `bun scripts/chat/check.ts FILE --show 5` and fix until it prints
   `"issues":0` and `validRecords` is at least COUNT.
5. Reread 20 of your records against the mark rules and fix any wrong
   boundary. The checker cannot see boundaries.

Quality bar. The file must read like a real seller's inbox. Vary the persona
(age, region, typing skill, phone or desktop), the layout, the field order,
the noise, and who the order is for (GUIDE hard rule 7). Aim for about a
quarter clean records, half moderately messy, and a quarter very messy but
still unambiguous to a careful human reader. Every mark must be exactly what a
person following GUIDE.md would mark. In the `train` pool, cover as many
different phenomena from STYLE-NOTES.md as your category allows, because the
parser learns from these records.

Fences. Write only FILE. Do not read any other file under
`bench/chat/sources/`, because writers must stay independent. Do not edit
code, GUIDE.md, STYLE-NOTES.md, or this brief. Run no git commands.

Final reply, six lines at most: the record count, the JSON line `check.ts`
printed, and any GUIDE rule you found ambiguous with the choice you made.
