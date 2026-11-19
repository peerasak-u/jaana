import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createTaggerParser, expandGazetteer } from "../src";

const FIELDS = ["name", "phone", "address", "subdistrict", "district", "province", "zipcode"] as const;
type Field = (typeof FIELDS)[number];

const FIELD_LABEL: Record<Field, string> = {
	name: "ชื่อผู้รับ",
	phone: "เบอร์โทร",
	address: "บ้านเลขที่ / หมู่ / ซอย",
	subdistrict: "ตำบล / แขวง",
	district: "อำเภอ / เขต",
	province: "จังหวัด",
	zipcode: "รหัสไปรษณีย์",
};

interface Row {
	readonly key: "jaana" | "haiku" | "deepseek";
	readonly label: string;
	readonly note: string;
	readonly color: string;
	readonly exact: number;
	readonly records: number;
	readonly fields: Record<Field, number>;
	readonly medianMs: number;
	readonly costUsd: number | null;
}

interface View {
	readonly rows: readonly Row[];
	readonly records: number;
	readonly groups: number;
	readonly sizeKb: number;
	readonly date: string;
}

const LOGO = await Bun.file(join(homedir(), ".claude/skills/peerasak-presentation-creator/references/slop-engineer-logo.svg")).text();

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const esc = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;");

function speed(ms: number): string {
	return ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(1)} วิ`;
}

const CSS = `
:root {
	--bg: #F7F2E8; --ink: #2C1E13; --brand: #594100; --muted: #7D6B5A;
	--border: #E2D5C1; --card: #FFFDF9; --accent: #D9733F; --accent-bg: #FBE6D8;
	--green: #2ba185;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1350px; }
body {
	font-family: 'Google Sans', 'Noto Sans Thai', system-ui, sans-serif;
	background: var(--bg); color: var(--ink); overflow: hidden; position: relative;
	-webkit-font-smoothing: antialiased;
}
.page { position: absolute; inset: 0; padding: 64px 68px 56px; display: flex; flex-direction: column; }
.blob { position: absolute; border-radius: 50%; filter: blur(2px); z-index: 0; }
.page > * { position: relative; z-index: 1; }
.top { display: flex; align-items: center; justify-content: space-between; }
.logo svg { height: 40px; width: auto; display: block; }
.pill {
	font-size: 22px; font-weight: 600; padding: 12px 24px; border-radius: 999px;
	background: var(--ink); color: #FBEFE3; letter-spacing: -0.01em;
}
.pill b { color: #F2A77E; }
.kicker { margin-top: 56px; font-size: 30px; font-weight: 600; color: var(--brand); letter-spacing: -0.01em; }
h1 { margin-top: 10px; font-size: 92px; line-height: 1.08; font-weight: 800; letter-spacing: -0.035em; }
h1 .hl { color: var(--accent); }
h1 .small { font-size: 64px; display: block; letter-spacing: -0.03em; }
.lede { margin-top: 18px; font-size: 26px; color: var(--muted); line-height: 1.5; }
.lede b { color: var(--ink); }
.card {
	background: var(--card); border: 1.5px solid var(--border); border-radius: 28px;
	padding: 36px 40px; box-shadow: 0 10px 30px rgba(89, 65, 0, 0.07);
}
.card h2 { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
.card .sub { font-size: 21px; color: var(--muted); margin-top: 4px; }
.bars { margin-top: 26px; display: flex; flex-direction: column; gap: 22px; }
.bar-row { display: grid; grid-template-columns: 250px 1fr 130px; align-items: center; gap: 18px; }
.bar-label { font-size: 25px; font-weight: 700; line-height: 1.15; }
.bar-label small { display: block; font-size: 17px; font-weight: 500; color: var(--muted); margin-top: 3px; }
.track { height: 46px; background: #F1E9DC; border-radius: 14px; overflow: hidden; }
.fill { height: 100%; border-radius: 14px; }
.bar-value { font-size: 40px; font-weight: 800; text-align: right; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.bar-value small { display: block; font-size: 17px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.tile { background: var(--card); border: 1.5px solid var(--border); border-radius: 24px; padding: 26px 26px 24px; }
.tile .big { font-size: 46px; font-weight: 800; letter-spacing: -0.035em; color: var(--accent); line-height: 1.1; }
.tile .big span { font-size: 26px; letter-spacing: -0.01em; }
.tile .what { font-size: 20px; color: var(--muted); margin-top: 8px; line-height: 1.4; }
.tile .what b { color: var(--ink); }
.headline2 { margin-top: 6px; font-size: 54px; font-weight: 800; line-height: 1.2; letter-spacing: -0.025em; }
.demo { margin-top: 36px; display: grid; grid-template-columns: 1fr 92px 400px; align-items: center; }
.chat { background: var(--card); border: 1.5px solid var(--border); border-radius: 26px; padding: 22px 24px 24px; box-shadow: 0 10px 30px rgba(89, 65, 0, 0.08); transform: rotate(-1.2deg); }
.chat-head { display: flex; align-items: center; gap: 10px; font-size: 18px; color: var(--muted); font-weight: 600; }
.avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #F2A77E, #D9733F); }
.bubble { margin-top: 14px; background: #F3ECE0; border-radius: 6px 22px 22px 22px; padding: 18px 20px; font-size: 21px; line-height: 1.85; }
mark { border-radius: 6px; padding: 2px 3px; color: var(--ink); font-weight: 600; }
mark.g-name, .out-key.g-name { background: #F9D3BC; }
mark.g-phone, .out-key.g-phone { background: #C9E8DF; }
mark.g-address, .out-key.g-address { background: #EDDDB0; }
mark.g-admin, .out-key.g-admin { background: #D6DDF2; }
.arrow { display: flex; flex-direction: column; align-items: center; color: var(--accent); }
.arrow span { font-size: 17px; font-weight: 800; }
.arrow b { font-size: 50px; line-height: 1; }
.arrow small { font-size: 15px; color: var(--muted); font-weight: 600; }
.out { background: var(--ink); color: #FBEFE3; border-radius: 26px; padding: 22px 22px 16px; box-shadow: 0 14px 34px rgba(44, 30, 19, 0.25); }
.out-head { font-size: 18px; font-weight: 700; color: #F2A77E; margin-bottom: 10px; }
.out-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid rgba(251, 239, 227, 0.12); }
.out-key { flex: none; width: 84px; text-align: center; font-size: 16px; font-weight: 700; color: var(--ink); border-radius: 8px; padding: 3px 0; }
.out-val { font-size: 21px; font-weight: 600; }
.out-val em { font-style: normal; font-size: 14px; font-weight: 700; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #F2A77E; color: var(--ink); vertical-align: 3px; }
.notes { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 10px; }
.notes span { font-size: 19px; font-weight: 600; background: var(--card); border: 1.5px solid var(--border); border-radius: 999px; padding: 8px 16px; }
.dense td { font-size: 22px; padding: 8px 8px; }
.dense th { padding: 8px 8px 9px; }
.dense tr.section th { padding-top: 18px; color: var(--muted); }
.spacer { flex: 1; }
.cta {
	display: flex; align-items: center; justify-content: space-between;
	background: var(--ink); color: #FBEFE3; border-radius: 22px; padding: 22px 32px;
	font-size: 26px; font-weight: 600;
}
.cta .url { color: #F2A77E; }
.foot { margin-top: 16px; font-size: 17px; color: var(--muted); line-height: 1.5; }
table { width: 100%; border-collapse: collapse; margin-top: 18px; font-variant-numeric: tabular-nums; }
th { font-size: 19px; font-weight: 700; color: var(--muted); text-align: right; padding: 10px 8px 12px; border-bottom: 2px solid var(--border); }
th:first-child { text-align: left; }
th.us { color: var(--accent); }
td { font-size: 24px; padding: 11px 8px; border-bottom: 1px solid #EFE6D7; text-align: right; }
td:first-child { text-align: left; font-weight: 600; }
td.us { font-weight: 800; color: var(--ink); background: var(--accent-bg); }
td.low { color: #C2483F; font-weight: 700; }
tr.total td { font-weight: 800; border-bottom: none; font-size: 27px; }
`;

function shell(title: string, body: string): string {
	return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="blob" style="width:520px;height:520px;right:-180px;top:-160px;background:#F6D9C4"></div>
<div class="blob" style="width:420px;height:420px;left:-200px;bottom:120px;background:#EFE3CC"></div>
<div class="page">${body}</div></body></html>`;
}

function top(pill: string): string {
	return `<div class="top"><div class="logo">${LOGO}</div><div class="pill">${pill}</div></div>`;
}

const EXAMPLE = "สวัสดีค่ะแม่ค้า 🙏 เอาเสื้อสีครีม 2 ตัว ไซส์ M โอนแล้วนะคะ\nส่งให้ คุณมายด์ ศรีสุข ค่ะ\n88/14 ม.5 ซ.วัดป่า ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร\nโทร 089-123-4567 ฝากป้อมยามได้เลยค่ะ";

type Group = "name" | "phone" | "address" | "admin";
const GROUP_OF: Record<string, Group> = { NAME: "name", PHONE: "phone", ADDRESS_DETAIL: "address", SUBDISTRICT: "admin", DISTRICT: "admin", PROVINCE: "admin", POSTCODE: "admin" };
const GROUP_OF_FIELD: Record<Field, Group> = { name: "name", phone: "phone", address: "address", subdistrict: "admin", district: "admin", province: "admin", zipcode: "admin" };
const SHORT_LABEL: Record<Field, string> = { name: "ชื่อ", phone: "เบอร์", address: "ที่อยู่", subdistrict: "ตำบล", district: "อำเภอ", province: "จังหวัด", zipcode: "ไปรษณีย์" };

interface Example {
	readonly raw: string;
	readonly spans: readonly { label: string; start: number; end: number }[];
	readonly fields: Record<Field, string | null>;
	readonly inferred: readonly Field[];
}

function highlighted(example: Example): string {
	let html = "";
	let cursor = 0;
	for (const span of [...example.spans].sort((left, right) => left.start - right.start)) {
		html += esc(example.raw.slice(cursor, span.start));
		html += `<mark class="g-${GROUP_OF[span.label]}">${esc(example.raw.slice(span.start, span.end))}</mark>`;
		cursor = span.end;
	}
	return (html + esc(example.raw.slice(cursor))).replace(/\n/gu, "<br>");
}

function hero(view: View, example: Example): string {
	const [jaana] = view.rows;
	const rows = FIELDS.map((field) => {
		const filled = example.inferred.includes(field);
		return `<div class="out-row"><span class="out-key g-${GROUP_OF_FIELD[field]}">${SHORT_LABEL[field]}</span><span class="out-val">${esc(example.fields[field] ?? "")}${filled ? `<em>เติมให้</em>` : ""}</span></div>`;
	}).join("");
	return shell("Jaana Model", `
		${top(`โอเพนซอร์ส · <b>รันในเบราว์เซอร์</b>`)}
		<div class="kicker" style="margin-top:44px">โมเดลตัวจิ๋ว ~${view.sizeKb} KB · รันบน CPU ไม่ต้องต่อเน็ต</div>
		<h1 style="font-size:104px"><span class="hl">Jaana</span> Model</h1>
		<div class="headline2">ถอดชื่อ ที่อยู่ เบอร์โทร<br>จากข้อความแชท</div>
		<div class="demo">
			<div class="chat">
				<div class="chat-head"><span class="avatar"></span><span>ลูกค้าทักมาในแชท</span></div>
				<div class="bubble">${highlighted(example)}</div>
			</div>
			<div class="arrow"><span>Jaana</span><b>→</b><small>${speed(jaana!.medianMs)}</small></div>
			<div class="out">
				<div class="out-head">ได้ข้อมูลพร้อมส่งของ</div>
				${rows}
			</div>
		</div>
		<div class="notes">
			<span>✂️ คำทักทาย ออเดอร์ ฝากป้อมยาม ตัดทิ้ง</span>
			<span>🧭 อ.เมือง → เมืองสกลนคร</span>
			<span>📮 ไม่ได้พิมพ์รหัสไปรษณีย์ ก็เติมให้</span>
		</div>
		<div class="tiles" style="margin-top:26px">
			<div class="tile"><div class="big">${pct(jaana!.exact, 0)}</div><div class="what">ถูกครบทั้ง 7 ช่อง<br>จาก ${view.records} แชทที่ไม่เคยเห็น</div></div>
			<div class="tile"><div class="big">${speed(jaana!.medianMs)}</div><div class="what">ต่อข้อความ<br>บน CPU เธรดเดียว</div></div>
			<div class="tile"><div class="big">0<span> บาท</span></div><div class="what">ไม่ต้องเรียก API<br><b>ข้อมูลลูกค้าไม่ออกจากเครื่อง</b></div></div>
		</div>
		<div class="spacer"></div>
		<div class="cta"><span>ลองเล่น / เอาไปใช้</span><span class="url">github.com/peerasak-u/jaana →</span></div>
		<div class="foot">ตัวอย่างในภาพคือผลจริงของโมเดล (ชื่อและเบอร์สมมติ) · ความแม่นวัด ${view.date} บน ${view.records} ข้อความ สุ่มเท่าๆกันจาก ${view.groups} หมวดของชุด holdout ที่ไม่เคยใช้เทรน · ข้อความทดสอบเป็นข้อมูลสังเคราะห์</div>
	`);
}

function detail(view: View): string {
	const us = (row: Row) => (row.key === "jaana" ? "us" : "");
	const head = view.rows.map((row) => `<th class="${us(row)}">${esc(row.label)}</th>`).join("");
	const body = FIELDS.map((field) => {
		const cells = view.rows.map((row) => {
			const value = row.fields[field];
			return `<td class="${row.key === "jaana" ? "us" : value < 0.9 ? "low" : ""}">${pct(value)}</td>`;
		}).join("");
		return `<tr><td>${FIELD_LABEL[field]}</td>${cells}</tr>`;
	}).join("");
	const cost = (row: Row) => (row.costUsd === null || row.costUsd === 0 ? "ฟรี" : `$${((row.costUsd / row.records) * 1000).toFixed(2)}`);
	const line = (title: string, value: (row: Row) => string) =>
		`<tr><td>${title}</td>${view.rows.map((row) => `<td class="${us(row)}">${value(row)}</td>`).join("")}</tr>`;
	const bars = view.rows.map((row) => `
		<div class="bar-row">
			<div class="bar-label" style="color:${row.key === "jaana" ? "var(--accent)" : "var(--ink)"}">${esc(row.label)}<small>${esc(row.key === "jaana" ? `~${view.sizeKb} KB · CPU ในเครื่อง` : row.note)}</small></div>
			<div class="track"><div class="fill" style="width:${(row.exact * 100).toFixed(1)}%;background:${row.color}"></div></div>
			<div class="bar-value" style="color:${row.key === "jaana" ? "var(--accent)" : "var(--ink)"}">${pct(row.exact)}<small>${Math.round(row.exact * row.records)}/${row.records} ข้อ</small></div>
		</div>`).join("");
	const llms = view.rows.filter((row) => row.key !== "jaana");
	const notes = [
		"Jaana วัดบน MacBook CPU เธรดเดียว",
		"LLM นับเวลาที่ API ใช้ตอบ ไม่รวมเวลาเปิดโปรแกรม และได้ prompt กติกาเดียวกับเฉลยพร้อมตัวอย่าง 3 ข้อ",
		...(llms.some((row) => row.key === "haiku") ? ["Haiku เรียกผ่าน Claude Code CLI คิดเงินตามราคา list ที่ CLI รายงาน"] : []),
		...(llms.some((row) => row.key === "deepseek") ? ["DeepSeek เรียกผ่าน OpenCode รุ่นฟรี ซึ่งแนบ prompt ของ agent มาด้วยทุกครั้ง"] : []),
		`ข้อความทดสอบเป็นข้อมูลสังเคราะห์ สุ่มเท่าๆกันจาก ${view.groups} หมวด · เฉลยตามกติกาใน bench/chat/GUIDE.md · วัด ${view.date}`,
	];
	return shell("Jaana Benchmark", `
		${top(`Benchmark · <b>${view.records} แชท</b>`)}
		<div class="kicker" style="margin-top:44px">ชุดทดสอบ holdout ที่โมเดลไม่เคยเห็นตอนเทรน</div>
		<h1 style="font-size:80px">แม่นแค่ไหน<span class="hl">?</span></h1>
		<div class="lede" style="margin-top:8px">ข้อหนึ่งต้องถูกครบทั้ง 7 ช่องถึงนับ ผิดช่องเดียว = ผิดทั้งข้อ</div>
		<div class="card" style="margin-top:24px;padding:26px 36px">
			<h2>ถูกครบทั้ง 7 ช่อง</h2>
			<div class="bars">${bars}</div>
		</div>
		<div class="card dense" style="margin-top:18px;padding:12px 34px 10px">
			<table><thead><tr><th>ถูกรายช่อง</th>${head}</tr></thead><tbody>${body}
			<tr class="section"><th>ใช้จริง</th>${view.rows.map(() => "<th></th>").join("")}</tr>
			${line("เวลาต่อข้อความ", (row) => speed(row.medianMs))}
			${line("ค่าใช้จ่าย / 1,000 ข้อความ", cost)}
			</tbody></table>
		</div>
		<div class="spacer"></div>
		<div class="foot">${notes.join(" · ")}</div>
	`);
}

export async function render(view: View, example: Example, outDir: string): Promise<string[]> {
	await mkdir(outDir, { recursive: true });
	const pages: Record<string, string> = { "jaana-1-what-it-does": hero(view, example) };
	if (view.rows.length > 1) pages["jaana-2-benchmark"] = detail(view);
	const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
	const outputs: string[] = [];
	for (const [name, html] of Object.entries(pages)) {
		const htmlPath = resolve(outDir, `${name}.html`);
		const pngPath = resolve(outDir, `${name}.png`);
		await Bun.write(htmlPath, html);
		const proc = Bun.spawn([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
			"--window-size=1080,1350", "--virtual-time-budget=8000", `--screenshot=${pngPath}`, `file://${htmlPath}`], { stdout: "ignore", stderr: "ignore" });
		await proc.exited;
		outputs.push(htmlPath, pngPath);
	}
	return outputs;
}

export type { View, Row };

interface Scored {
	readonly records: number;
	readonly exactRecords: number;
	readonly fields: Record<Field, { accuracy: number }>;
}

interface Summary {
	readonly sampleRecords: number;
	readonly tagger: Scored & { readonly categories: Record<string, unknown>; readonly parseMs: { median: number } };
	readonly systems: Partial<Record<"haiku" | "deepseek", Scored & { apiMs: { median: number }; costUsd: number }>>;
}

const LLMS = [
	{ key: "haiku", label: "Claude Haiku 5.5", note: "API · Anthropic", color: "#B5855A" },
	{ key: "deepseek", label: "DeepSeek 4.1 Flash", note: "API · รุ่นฟรีบน OpenCode", color: "#A69080" },
] as const;

const fieldsOf = (scored: Scored) => Object.fromEntries(FIELDS.map((field) => [field, scored.fields[field].accuracy])) as Record<Field, number>;

async function shippedKb(modelGzipBytes: number): Promise<number> {
	const build = await Bun.build({ entrypoints: ["src/index.ts"], target: "browser", format: "esm" });
	if (!build.success) throw new Error("library build failed");
	const library = Bun.gzipSync(new Uint8Array(await build.outputs[0]!.arrayBuffer())).length;
	const gazetteer = Bun.gzipSync(new Uint8Array(await Bun.file("resources/gazetteer.json").arrayBuffer())).length;
	return Math.round((modelGzipBytes + gazetteer + library) / 1024 / 10) * 10;
}

if (import.meta.main) {
	const summaryPath = Bun.argv[2] ?? "bench/llm/results/holdout/summary-120.json";
	const outDir = Bun.argv[3] ?? "docs/infographic";
	const summary = (await Bun.file(summaryPath).json()) as Summary;
	const complete = LLMS.filter(({ key }) => summary.systems[key]?.records === summary.sampleRecords);
	for (const { key } of LLMS.filter((llm) => !complete.includes(llm))) {
		console.error(`leaving ${key} off the benchmark card: it has ${summary.systems[key]?.records ?? 0}/${summary.sampleRecords} answers`);
	}
	const { tagger } = summary;
	const view: View = {
		records: summary.sampleRecords,
		groups: Object.keys(tagger.categories).length,
		sizeKb: await shippedKb((tagger as unknown as { modelGzipBytes: number }).modelGzipBytes),
		date: new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }),
		rows: [
			{ key: "jaana", label: "Jaana", note: "", color: "#D9733F", exact: tagger.exactRecords / tagger.records, records: tagger.records, fields: fieldsOf(tagger), medianMs: tagger.parseMs.median, costUsd: 0 },
			...complete.map(({ key, label, note, color }) => {
				const system = summary.systems[key]!;
				return { key, label, note, color, exact: system.exactRecords / system.records, records: system.records, fields: fieldsOf(system), medianMs: system.apiMs.median, costUsd: system.costUsd };
			}),
		],
	};
	const parser = createTaggerParser(await Bun.file("resources/tagger-model.json").json(), expandGazetteer(await Bun.file("resources/gazetteer.json").json()));
	const parsed = parser.parse(EXAMPLE);
	const example: Example = { raw: EXAMPLE, spans: parsed.spans, fields: parsed.fields, inferred: parsed.inferred };
	console.log((await render(view, example, outDir)).join("\n"));
}
