import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

function hero(view: View): string {
	const [jaana, ...llms] = view.rows;
	const best = Math.max(...llms.map((row) => row.exact));
	const slowest = Math.min(...llms.map((row) => row.medianMs));
	const bars = view.rows.map((row) => `
		<div class="bar-row">
			<div class="bar-label" style="color:${row.key === "jaana" ? "var(--accent)" : "var(--ink)"}">${esc(row.label)}<small>${esc(row.key === "jaana" ? `~${view.sizeKb} KB · CPU ในเครื่อง` : row.note)}</small></div>
			<div class="track"><div class="fill" style="width:${(row.exact * 100).toFixed(1)}%;background:${row.color}"></div></div>
			<div class="bar-value" style="color:${row.key === "jaana" ? "var(--accent)" : "var(--ink)"}">${pct(row.exact)}<small>${Math.round(row.exact * row.records)}/${row.records} ข้อ</small></div>
		</div>`).join("");
	const lead = Math.round((jaana!.exact - best) * 100);
	const wins = lead > 0;
	return shell("Jaana vs LLM", `
		${top(`โอเพนซอร์ส · <b>รันในเบราว์เซอร์</b>`)}
		<div class="kicker">โมเดลแกะที่อยู่จากแชท ตัวจิ๋วแค่ ~${view.sizeKb} KB</div>
		<h1><span class="hl">จ่าหน้า</span> ${wins ? "แกะแม่นกว่า" : "แกะสูสี"}<span class="small">Haiku 5.5 &amp; DeepSeek 4.1 Flash</span></h1>
		<div class="lede">ลูกค้าพิมพ์ที่อยู่มั่วแค่ไหน ก็แยก <b>ชื่อ · เบอร์ · ที่อยู่ · ตำบล · อำเภอ · จังหวัด · รหัสไปรษณีย์</b> ออกมาให้ครบ (ไม่ต้องจ่ายค่า token สักบาท)</div>
		<div class="card" style="margin-top:34px">
			<h2>ถูกครบทั้ง 7 ช่อง กี่ข้อ?</h2>
			<div class="sub">${view.records} ข้อความแชทที่โมเดลไม่เคยเห็น · ผิดช่องเดียว = ผิดทั้งข้อ</div>
			<div class="bars">${bars}</div>
		</div>
		<div class="tiles" style="margin-top:22px">
			<div class="tile"><div class="big">${wins ? "+" : ""}${lead}<span> แต้ม</span></div><div class="what">${wins ? "นำ LLM ที่ดีที่สุดในรอบนี้" : "ห่างจาก LLM ที่ดีที่สุด"}</div></div>
			<div class="tile"><div class="big">${speed(jaana!.medianMs)}</div><div class="what">ต่อข้อความบน CPU<br>LLM ใช้ <b>${speed(slowest)}+</b></div></div>
			<div class="tile"><div class="big">0<span> บาท</span></div><div class="what">ไม่ต้องต่อเน็ต<br><b>ข้อมูลลูกค้าไม่ออกจากเครื่อง</b></div></div>
		</div>
		<div class="spacer"></div>
		<div class="cta"><span>ลองเล่น / เอาไปใช้</span><span class="url">github.com/peerasak-u/jaana →</span></div>
		<div class="foot">ทดสอบ ${view.date} · ${view.records} ข้อความ สุ่มเท่าๆกันจาก ${view.groups} หมวด ของชุด holdout ที่ไม่เคยใช้เทรน · LLM ได้ prompt กติกาเดียวกับเฉลยพร้อมตัวอย่าง 3 ข้อ · ข้อความทั้งหมดเป็นข้อมูลสังเคราะห์ · ${view.records} ข้อยังน้อย ต่างกัน 1-2 ข้อถือว่าสูสี</div>
	`);
}

function detail(view: View): string {
	const head = view.rows.map((row) => `<th class="${row.key === "jaana" ? "us" : ""}">${esc(row.label)}</th>`).join("");
	const body = FIELDS.map((field) => {
		const cells = view.rows.map((row) => {
			const value = row.fields[field];
			const cls = row.key === "jaana" ? "us" : value < 0.9 ? "low" : "";
			return `<td class="${cls}">${pct(value)}</td>`;
		}).join("");
		return `<tr><td>${FIELD_LABEL[field]}</td>${cells}</tr>`;
	}).join("");
	const total = view.rows.map((row) => `<td class="${row.key === "jaana" ? "us" : ""}">${pct(row.exact)}</td>`).join("");
	const cost = (row: Row) => row.costUsd === null || row.costUsd === 0 ? "ฟรี" : `$${((row.costUsd / row.records) * 1000).toFixed(2)}`;
	const line = (title: string, value: (row: Row) => string) =>
		`<tr><td>${title}</td>${view.rows.map((row) => `<td class="${row.key === "jaana" ? "us" : ""}">${value(row)}</td>`).join("")}</tr>`;
	return shell("Jaana vs LLM: per field", `
		${top(`เจาะทีละช่อง`)}
		<h1 style="margin-top:48px;font-size:72px">LLM พลาด<span class="hl">ตรงไหน?</span></h1>
		<div class="lede">% ที่ตอบถูกในแต่ละช่อง จาก ${view.records} ข้อความเดียวกัน · ตัวแดง = ต่ำกว่า 90%</div>
		<div class="card" style="margin-top:28px;padding:26px 34px 18px">
			<table><thead><tr><th>ช่อง</th>${head}</tr></thead><tbody>${body}
			<tr class="total"><td>ถูกครบทั้งข้อ</td>${total}</tr></tbody></table>
		</div>
		<div class="card" style="margin-top:20px;padding:22px 34px 14px">
			<table><thead><tr><th>ใช้จริง</th>${head}</tr></thead><tbody>
			${line("เวลาต่อข้อความ", (row) => speed(row.medianMs))}
			${line("ค่าใช้จ่าย / 1,000 ข้อความ", cost)}
			${line("รันที่ไหน", (row) => row.key === "jaana" ? "ในเครื่อง" : "คลาวด์")}
			</tbody></table>
		</div>
		<div class="spacer"></div>
		<div class="foot">จ่าหน้า วัดบน MacBook CPU เธรดเดียว · LLM นับเวลาที่ API ใช้ตอบ (ไม่รวมเวลาเปิดโปรแกรม) · Haiku เรียกผ่าน Claude Code CLI คิดเงินตามราคา list ที่ CLI รายงาน · DeepSeek เรียกผ่าน OpenCode รุ่นฟรี ซึ่งแนบ prompt ของ agent มาด้วยทุกครั้ง · เฉลยตามกติกาใน bench/chat/GUIDE.md</div>
	`);
}

export async function render(view: View, outDir: string): Promise<string[]> {
	await mkdir(outDir, { recursive: true });
	const pages = { "jaana-vs-llm-1": hero(view), "jaana-vs-llm-2": detail(view) };
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
	const summaryPath = Bun.argv[2] ?? "bench/llm/results/holdout/summary.json";
	const outDir = Bun.argv[3] ?? "docs/infographic";
	const summary = (await Bun.file(summaryPath).json()) as Summary;
	const missing = LLMS.filter(({ key }) => summary.systems[key]?.records !== summary.sampleRecords);
	if (missing.length > 0) {
		throw new Error(`${missing.map(({ key }) => `${key} has ${summary.systems[key]?.records ?? 0}/${summary.sampleRecords}`).join(", ")}. Finish the run and rescore with --systems haiku,deepseek --limit 0 first`);
	}
	const { tagger } = summary;
	const view: View = {
		records: summary.sampleRecords,
		groups: Object.keys(tagger.categories).length,
		sizeKb: await shippedKb((tagger as unknown as { modelGzipBytes: number }).modelGzipBytes),
		date: new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }),
		rows: [
			{ key: "jaana", label: "จ่าหน้า", note: "", color: "#D9733F", exact: tagger.exactRecords / tagger.records, records: tagger.records, fields: fieldsOf(tagger), medianMs: tagger.parseMs.median, costUsd: 0 },
			...LLMS.map(({ key, label, note, color }) => {
				const system = summary.systems[key]!;
				return { key, label, note, color, exact: system.exactRecords / system.records, records: system.records, fields: fieldsOf(system), medianMs: system.apiMs.median, costUsd: system.costUsd };
			}),
		],
	};
	console.log((await render(view, outDir)).join("\n"));
}
