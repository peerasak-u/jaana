import { useMemo, useState } from "react";
import { expandGazetteer, type CompactGazetteer } from "./gazetteer";
import { createAddressParser } from "./parser";
import type { TaggerModel } from "./tagger/model";
import { createTaggerParser } from "./tagger/parser";
import type { FieldName, ParsedFields, ParserResources } from "./types";
import gazetteer from "../resources/gazetteer.json";
import taggerModel from "../resources/tagger-model.json";

const examples = [
	{
		label: "ที่อยู่ครบถ้วน",
		value: "นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 10330",
	},
	{
		label: "ไม่มีชื่อและเบอร์",
		value: "บ้านเลขที่ 99/12 ถนนพระรามที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 10330",
	},
	{
		label: "รหัสไปรษณีย์ไม่ตรง",
		value: "บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 99999",
	},
] as const;

const fields: ReadonlyArray<{ key: FieldName; label: string }> = [
	{ key: "name", label: "ชื่อผู้รับ" },
	{ key: "phone", label: "โทรศัพท์" },
	{ key: "address", label: "ที่อยู่" },
	{ key: "subdistrict", label: "แขวง / ตำบล" },
	{ key: "district", label: "เขต / อำเภอ" },
	{ key: "province", label: "จังหวัด" },
	{ key: "zipcode", label: "รหัสไปรษณีย์" },
];

const compact = gazetteer as unknown as CompactGazetteer;
const resources: ParserResources = {
	version: compact.version,
	locations: expandGazetteer(compact),
};
const model = taggerModel as TaggerModel;
const initialInput: string = examples[0].value;

type ParserChoice = "tagger" | "engine";

const parserChoices: ReadonlyArray<{ key: ParserChoice; label: string }> = [
	{ key: "tagger", label: "Tagger · โมเดลจิ๋ว" },
	{ key: "engine", label: "Candidate Engine · กฎ" },
];

interface DemoResult {
	readonly fields: ParsedFields;
	readonly headline: string;
	readonly caption: string;
	readonly details: readonly string[];
	readonly abstentions: readonly string[];
}

const demoParsers: Record<ParserChoice, (raw: string) => DemoResult> = (() => {
	const tagger = createTaggerParser(model, resources.locations);
	const engine = createAddressParser(resources);
	return {
		tagger(raw) {
			const result = tagger.parse(raw);
			const found = Object.values(result.fields).filter((value) => value !== null).length;
			return {
				fields: result.fields,
				headline: `${found}/7`,
				caption: "fields ที่พบ",
				details: [`${raw.length} characters tagged`, `${result.spans.length} spans`, model.version],
				abstentions: [],
			};
		},
		engine(raw) {
			const result = engine.parse(raw);
			return {
				fields: result.fields,
				headline: `${Math.round(result.confidence * 100)}%`,
				caption: scoreLabel(result.confidence),
				details: [
					`${result.diagnostics.candidatesEvaluated} candidates`,
					`${result.diagnostics.hypothesesEvaluated} hypotheses`,
					`${result.spans.length} fields accepted`,
				],
				abstentions: result.abstentions.map(({ field, reason }) => `${field} (${reason})`),
			};
		},
	};
})();

function scoreLabel(confidence: number): string {
	if (confidence >= 0.8) return "มั่นใจสูง";
	if (confidence >= 0.6) return "มั่นใจปานกลาง";
	if (confidence > 0) return "มั่นใจต่ำ";
	return "ไม่พบข้อมูล";
}

function formatComputeTime(computeMs: number): string {
	return `${computeMs.toFixed(computeMs < 10 ? 2 : 1)} ms`;
}

function ResultPanel({
	result,
	computeMs,
}: {
	result: DemoResult;
	computeMs: number;
}) {
	return (
		<section className="result-panel" aria-live="polite">
			<div className="result-heading">
				<div>
					<p className="eyebrow">ผลการแยกข้อมูล</p>
					<h2>Address record</h2>
				</div>
				<div className="confidence" title={`${result.headline} ${result.caption}`}>
					<strong>{result.headline}</strong>
					<span>{result.caption}</span>
				</div>
			</div>

			<dl className="field-grid">
				{fields.map(({ key, label }) => (
					<div className="field" key={key}>
						<dt>{label}</dt>
						<dd className={result.fields[key] ? "" : "empty"}>
							{result.fields[key] ?? "—"}
						</dd>
					</div>
				))}
			</dl>

			<div className="diagnostics">
				<span className="compute-time">
					compute {formatComputeTime(computeMs)}
				</span>
				{result.details.map((detail) => (
					<span key={detail}>{detail}</span>
				))}
			</div>

			{result.abstentions.length > 0 && (
				<p className="abstentions">
					<strong>ละเว้นข้อมูล:</strong> {result.abstentions.join(", ")}
				</p>
			)}
		</section>
	);
}

export function App() {
	const [choice, setChoice] = useState<ParserChoice>("tagger");
	const [draft, setDraft] = useState(initialInput);
	const [submitted, setSubmitted] = useState(initialInput);
	const { result, computeMs } = useMemo(() => {
		const start = performance.now();
		const parsed = demoParsers[choice](submitted);
		return { result: parsed, computeMs: performance.now() - start };
	}, [choice, submitted]);

	function runParser(): void {
		setSubmitted(draft.trim());
	}

	function loadExample(value: string): void {
		setDraft(value);
		setSubmitted(value);
	}

	return (
		<main className="page-shell">
			<header className="hero">
				<div className="brand" aria-label="Thai Address Parser">
					<span className="brand-mark">ท</span>
					<span>
						TH Address <em>latent</em>
					</span>
				</div>
				<div className="hero-copy">
					<p className="eyebrow">Browser playground</p>
					<h1>
						ลองแยกที่อยู่ไทย
						<br />
						ในเบราว์เซอร์
					</h1>
					<p className="lede">
						พิมพ์ข้อความที่อยู่ แล้วเทียบผลจากโมเดลจิ๋วที่ติดป้ายทีละตัวอักษร
						กับ parser แบบกฎ ทั้งสองตัวทำงานในเบราว์เซอร์นี้
					</p>
				</div>
				<div className="resource-note">
					<span className="resource-dot" />
					Gazetteer <strong>{resources.version}</strong>
					<a className="explainer-link" href="explainer.html">How it works ↗</a>
				</div>
			</header>

			<section className="workbench" aria-label="Thai address parser demo">
				<div className="input-panel">
					<div className="panel-heading">
						<div>
							<p className="eyebrow">Input</p>
							<h2>ข้อความที่อยู่</h2>
						</div>
						<span className="character-count">{draft.length} ตัวอักษร</span>
					</div>

					<label className="sr-only" htmlFor="address-input">
						ข้อความที่อยู่ภาษาไทย
					</label>
					<textarea
						id="address-input"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="เช่น บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330"
						rows={7}
					/>

					<div className="input-actions">
						<button className="run-button" type="button" onClick={runParser}>
							แยกที่อยู่ <span aria-hidden="true">↗</span>
						</button>
						<button
							className="clear-button"
							type="button"
							onClick={() => setDraft("")}
						>
							ล้างข้อความ
						</button>
					</div>

					<div className="example-block">
						<p>เลือก parser</p>
						<div className="example-buttons">
							{parserChoices.map(({ key, label }) => (
								<button
									className={`example-button${choice === key ? " active" : ""}`}
									type="button"
									key={key}
									aria-pressed={choice === key}
									onClick={() => setChoice(key)}
								>
									{label}
								</button>
							))}
						</div>
					</div>

					<div className="example-block">
						<p>ลองตัวอย่าง</p>
						<div className="example-buttons">
							{examples.map((example) => (
								<button
									className="example-button"
									type="button"
									key={example.label}
									onClick={() => loadExample(example.value)}
								>
									{example.label}
								</button>
							))}
						</div>
					</div>
				</div>

				<ResultPanel result={result} computeMs={computeMs} />
			</section>

			<footer>
				<span>Anchor → Tagger → Resolver</span>
				<span>Runs fully in your browser</span>
			</footer>
		</main>
	);
}
