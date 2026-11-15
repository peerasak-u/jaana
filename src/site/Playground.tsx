import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TaggedSpan } from "../tagger/parser";
import { EXAMPLES } from "./examples";
import { FIELD_BY_LABEL, FIELDS } from "./fields";

type Engine = typeof import("./engine");

function highlight(raw: string, spans: readonly TaggedSpan[]): ReactNode[] {
	const ordered = [...spans].sort((left, right) => left.start - right.start);
	const parts: ReactNode[] = [];
	let cursor = 0;
	for (const span of ordered) {
		if (span.start < cursor) continue;
		if (span.start > cursor) parts.push(raw.slice(cursor, span.start));
		const field = FIELD_BY_LABEL.get(span.label)!;
		parts.push(
			<mark key={span.start} className={`hl f-${field.key}`} title={field.thai}>
				{raw.slice(span.start, span.end)}
			</mark>,
		);
		cursor = span.end;
	}
	if (cursor < raw.length) parts.push(raw.slice(cursor));
	return parts;
}

function formatMs(ms: number): string {
	return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

export function Playground() {
	const [engine, setEngine] = useState<Engine | null>(null);
	const [failed, setFailed] = useState(false);
	const [active, setActive] = useState(EXAMPLES[0]!.id);
	const [draft, setDraft] = useState(EXAMPLES[0]!.text);
	const input = useDeferredValue(draft);

	useEffect(() => {
		import("./engine").then(setEngine, () => setFailed(true));
	}, []);

	const parsed = useMemo(() => (engine && input.trim() ? engine.parseTimed(input) : null), [engine, input]);

	return (
		<div className="playground">
			<div className="pg-input">
				<div className="pg-head">
					<label htmlFor="message">วางข้อความจากแชต</label>
					<span className="muted">{draft.length} ตัวอักษร</span>
				</div>
				<textarea
					id="message"
					value={draft}
					onChange={(event) => {
						setDraft(event.target.value);
						setActive("");
					}}
					rows={7}
					spellCheck={false}
					autoComplete="off"
					placeholder="เช่น คุณสมชาย 089-123-4567 99/1 หมู่ 2 ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000"
				/>
				<div className="pg-actions">
					<button type="button" className="btn-quiet" onClick={() => { setDraft(""); setActive(""); }}>
						ล้างข้อความ
					</button>
					<span className="privacy">ประมวลผลในเบราว์เซอร์นี้ ข้อความไม่ถูกส่งออกไปไหน</span>
				</div>
				<p className="examples-title" id="examples-title">ตัวอย่างข้อความ</p>
				<div className="examples" role="group" aria-labelledby="examples-title">
					{EXAMPLES.map((example) => (
						<button
							type="button"
							key={example.id}
							className="chip"
							aria-pressed={active === example.id}
							onClick={() => {
								setDraft(example.text);
								setActive(example.id);
							}}
						>
							{example.label}
						</button>
					))}
				</div>
			</div>

			<div className="pg-output" aria-live="polite">
				<div className="label-card">
					<div className="label-head">
						<span>ผลที่แยกได้</span>
						<span className="timing">
							{parsed ? (
								<>
									<strong>{formatMs(parsed.ms)} ms</strong>
									<span className="muted"> ค่ากลางจาก {parsed.rounds} รอบ บนเครื่องนี้</span>
								</>
							) : failed ? (
								"โหลดโมเดลไม่สำเร็จ"
							) : engine ? (
								<span className="muted">รอข้อความ</span>
							) : (
								<span className="muted">กำลังโหลดโมเดล…</span>
							)}
						</span>
					</div>
					<dl className="fields">
						{FIELDS.map((field) => {
							const value = parsed?.result.fields[field.key] ?? null;
							return (
								<div className="field" key={field.key}>
									<dt>
										<span className={`swatch f-${field.key}`} aria-hidden="true" />
										{field.thai}
									</dt>
									<dd className={value ? undefined : "empty"}>{value ?? "ไม่พบ"}</dd>
								</div>
							);
						})}
					</dl>
				</div>
				<div className="source">
					<p className="source-title">ข้อความเดิม ไฮไลต์ตามช่อง</p>
					<p className="source-text">{parsed ? highlight(parsed.result.raw, parsed.result.spans) : input || <span className="muted">ยังไม่มีข้อความ</span>}</p>
				</div>
			</div>
		</div>
	);
}
