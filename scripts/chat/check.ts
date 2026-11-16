import { loadParserResources } from "../../bench/gazetteer";
import { loadSourceFile, locationMap, sourcePoolOf } from "../../bench/chat/load";

const paths = Bun.argv.slice(2).filter((argument) => argument.endsWith(".txt"));
if (paths.length === 0) throw new Error("usage: bun scripts/chat/check.ts <bench/chat/sources/(bench|train|spent|dev)/file.txt> [--show N]");
const showIndex = Bun.argv.indexOf("--show");
const show = showIndex >= 0 ? Number(Bun.argv[showIndex + 1]) : 0;

const { locations } = await loadParserResources("resources/gazetteer.json");
const map = locationMap(locations);
let failed = false;
for (const path of paths) {
	const { records, issues } = await loadSourceFile(path, sourcePoolOf(path), map);
	for (const issue of issues) console.log(`${issue.file}:${issue.line} ${issue.message}`);
	const fieldCounts: Record<string, number> = {};
	for (const record of records) {
		for (const [field, value] of Object.entries(record.expected)) {
			if (value !== null) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
		}
	}
	const warningCounts: Record<string, number> = {};
	for (const warning of records.flatMap((record) => record.warnings)) warningCounts[warning] = (warningCounts[warning] ?? 0) + 1;
	const tuples = new Set(records.map((record) => Object.values(record.seedLocation).join("|")));
	console.log(JSON.stringify({
		path,
		validRecords: records.length,
		issues: issues.length,
		distinctLocations: tuples.size,
		multiline: records.filter((record) => record.raw.includes("\n")).length,
		medianLength: records.map((record) => record.raw.length).sort((a, b) => a - b)[Math.floor(records.length / 2)] ?? 0,
		fieldCounts,
		warningCounts,
		multiRecipient: records.filter((record) => record.recipients.length > 1).length,
	}));
	for (const record of records.slice(0, show)) {
		console.log(JSON.stringify({ raw: record.raw, warnings: record.warnings, recipients: record.recipients }, null, 1));
	}
	if (issues.length > 0) failed = true;
}
process.exit(failed ? 1 : 0);
