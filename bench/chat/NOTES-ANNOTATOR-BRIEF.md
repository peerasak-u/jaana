# Notes annotator brief

GUIDE v3 adds the `R` mark for delivery notes. Files written before v3 have
no `R` marks. You add them to one or more existing files.

Your prompt gives you FILES. Run every command from the repository root.

1. Read `bench/chat/GUIDE.md` in full, and read the section
   "R, the delivery note" twice. It is the contract.
2. Read every record in each file. Wrap each delivery note in `[[R:...]]`
   (`[[R2:...]]` for the second delivery of a multi-recipient record).
3. Add `R` marks only. Never change a character of the message, any other
   mark, or any header line. Removing your `R` marks must give back the file
   exactly as it was. Text inside another mark is never `R`: if a landmark is
   already inside an `A` mark, leave it there.
4. Run `bun scripts/chat/check.ts <file>` for each file and fix until it prints
   `"issues":0` with the same `validRecords` as before you started.
5. Reread every record you marked and twenty you left unmarked against the R
   rules: clause boundaries, particles left outside, nothing that is only a
   greeting, an order item, a price or a payment already made.

Fences. Write only FILES. Do not read other files under `bench/chat/sources/`.
Do not edit code or docs. Run no git commands.

Final reply, six lines at most: per file the record count and the number of
`R` marks you added, the JSON line `check.ts` printed, and any R rule you
found ambiguous with the choice you made.
