import { FIELDS } from "./site/fields";
import { Playground } from "./site/Playground";
import { PLACEHOLDER, REPO_URL, STATS } from "./site/stats";

const SNIPPET = `import { createTaggerParser, expandGazetteer } from "./src";
import gazetteer from "./resources/gazetteer.json";
import model from "./resources/tagger-model.json";

const parser = createTaggerParser(model, expandGazetteer(gazetteer));
const { fields, spans } = parser.parse(chatMessage);
// fields.name, fields.phone, fields.address, fields.subdistrict,
// fields.district, fields.province, fields.zipcode`;

const STEPS = [
	{
		title: "ติดป้ายทีละตัวอักษร",
		en: "Character tagger",
		body: "โมเดลขนาดเล็กอ่านข้อความทีละตัวอักษร แล้วให้คะแนนว่าตัวนั้นเป็นส่วนของชื่อ เบอร์ ที่อยู่ ตำบล อำเภอ จังหวัด รหัสไปรษณีย์ หรือไม่ใช่อะไรเลย ไม่ต้องตัดคำก่อน",
	},
	{
		title: "ถอดรหัสแบบมีกติกา",
		en: "Constrained decoding",
		body: "Viterbi เลือกลำดับป้ายที่คะแนนรวมสูงสุดภายใต้กติกา เช่น ช่วงหนึ่งต้องเป็นป้ายเดียวกันทั้งช่วง ผลที่ได้จึงเป็นช่วงข้อความที่ต่อเนื่อง ไม่ใช่ตัวอักษรกระจัดกระจาย",
	},
	{
		title: "เทียบกับฐานข้อมูลพื้นที่",
		en: "Gazetteer resolver",
		body: `ช่วงที่เป็นตำบล อำเภอ จังหวัด และรหัสไปรษณีย์ ถูกจับคู่กับชุดพื้นที่จริงหนึ่งชุดจากฐานข้อมูล ${STATS.datasets.gazetteerTuples.toLocaleString()} ชุด จึงแก้คำสะกดผิดและเติมช่องที่ผู้ใช้ไม่ได้พิมพ์ได้ และไม่คืนพื้นที่ที่ไม่มีอยู่จริง`,
	},
	{
		title: "ประกอบชื่อผู้รับ",
		en: "Recipient composition",
		body: "เลือกชื่อผู้รับจริงเมื่อข้อความมีหลายชื่อ เช่น คนสั่งกับคนรับเป็นคนละคน และเก็บชื่อบริษัทหรือหน่วยงานไว้คู่กับผู้ติดต่อ",
	},
];

const INDUSTRIES = [
	{ title: "ร้านค้าออนไลน์", body: "ลูกค้าพิมพ์ที่อยู่มาในแชต LINE หรือ Facebook แอดมินกดวางครั้งเดียวได้ข้อมูลครบเจ็ดช่อง ไม่ต้องคัดลอกทีละบรรทัด" },
	{ title: "ขนส่งและไปรษณีย์", body: "ตรวจตำบล อำเภอ จังหวัด และรหัสไปรษณีย์ให้สอดคล้องกันก่อนพิมพ์ใบปะหน้า ลดพัสดุตีกลับ" },
	{ title: "CRM และบริการลูกค้า", body: "แปลงข้อความอิสระเป็นข้อมูลลูกค้าที่ค้นหาและจัดกลุ่มตามพื้นที่ได้" },
	{ title: "งานคีย์ข้อมูล", body: "เติมฟอร์มให้อัตโนมัติจากข้อความที่วาง พนักงานแค่ตรวจทานแทนการพิมพ์ใหม่" },
	{ title: "มาร์เก็ตเพลส", body: "ใส่ไว้ในหน้าเว็บหรือแอปของผู้ขายได้เลย เพราะรันฝั่งเบราว์เซอร์ ไม่ต้องตั้งเซิร์ฟเวอร์ ไม่มีค่า API" },
];

const LIMITS = [
	"รองรับเฉพาะที่อยู่ในประเทศไทย ชื่อตำบล อำเภอ จังหวัด ต้องอยู่ในฐานข้อมูลพื้นที่ที่แนบมา",
	"หนึ่งข้อความต่อหนึ่งที่อยู่ ถ้าแชตมีหลายที่อยู่ ต้องแยกข้อความก่อน",
	"ชุดทดสอบเป็นข้อความสังเคราะห์ที่ผ่านการรีวิว ยังไม่ได้วัดกับข้อความลูกค้าจริง ผลกับข้อมูลของคุณอาจต่างออกไป",
	"ไม่ได้ตรวจว่าบ้านเลขที่หรือเบอร์โทรมีอยู่จริง ตรวจได้แค่รูปแบบ",
	"ควรให้คนตรวจทานก่อนส่งของ โดยเฉพาะข้อความที่พิมพ์ผิดมากหรือข้อมูลไม่ครบ",
];

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function PlaceholderBadge() {
	if (!PLACEHOLDER) return null;
	return <span className="badge" title="ตัวเลขยังไม่ใช่ผลวัดจริง">ตัวเลขชั่วคราว</span>;
}

function Results() {
	const { holdout, categories, fields, parseMs, datasets } = STATS;
	const fieldThai = new Map(FIELDS.map((field) => [field.key, field.thai]));
	return (
		<>
			<div className="kpis">
				<div className="kpi">
					<strong>{percent(holdout.exact / holdout.records)}</strong>
					<span>ถูกครบทั้งเจ็ดช่อง ({holdout.exact.toLocaleString()} จาก {holdout.records.toLocaleString()} ข้อความ)</span>
				</div>
				<div className="kpi">
					<strong>{STATS.modelGzipKB + STATS.gazetteerGzipKB} KB</strong>
					<span>โมเดล {STATS.modelGzipKB} KB + ฐานข้อมูลพื้นที่ {STATS.gazetteerGzipKB} KB (gzip)</span>
				</div>
				<div className="kpi">
					<strong>{parseMs.median} ms</strong>
					<span>ค่ากลางต่อข้อความ p95 {parseMs.p95} ms</span>
				</div>
			</div>

			<div className="results-grid">
				<div>
					<h3>ความแม่นยำแยกตามประเภทข้อความ</h3>
					<ul className="bars">
						{categories.map((row) => {
							const share = row.records ? row.exact / row.records : 0;
							return (
								<li key={row.category}>
									<span className="bar-label">{row.labelThai}</span>
									<span className="bar-track" aria-hidden="true">
										<span className="bar-fill" style={{ width: `${share * 100}%` }} />
									</span>
									<span className="bar-value">
										{percent(share)} <span className="muted">{row.exact}/{row.records}</span>
									</span>
								</li>
							);
						})}
					</ul>
				</div>
				<div>
					<h3>ความแม่นยำรายช่อง</h3>
					<ul className="bars">
						{fields.map((row) => (
							<li key={row.field}>
								<span className="bar-label">
									<span className={`swatch f-${row.field}`} aria-hidden="true" />
									{fieldThai.get(row.field)}
								</span>
								<span className="bar-track" aria-hidden="true">
									<span className={`bar-fill f-${row.field}`} style={{ width: `${row.accuracy * 100}%` }} />
								</span>
								<span className="bar-value">{percent(row.accuracy)}</span>
							</li>
						))}
					</ul>
					<h3>วัดอย่างไร</h3>
					<p>
						ชุดทดสอบแบ่งเป็น 14 ประเภท ตั้งแต่ข้อความบรรทัดเดียว แชตที่ปนรายการสั่งซื้อ ไปจนถึงคำสะกดผิดและผู้รับแทน
						ข้อความเขียนโดยเอเจนต์ชุดหนึ่งและตรวจทานโดยเอเจนต์อีกชุดที่แยกกัน แล้วปิดผนึกไว้ ไม่ใช้ฝึกโมเดล
						นับว่าถูกเมื่อทั้งเจ็ดช่องตรงกับคำตอบทุกตัวอักษร
						ฝึกด้วย {datasets.trainRecords.toLocaleString()} ข้อความ ทดสอบ {datasets.holdoutRecords.toLocaleString()} ข้อความ
						วัดเมื่อ {STATS.measuredOn}
					</p>
					<ul className="caveats">
						{STATS.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
					</ul>
				</div>
			</div>
		</>
	);
}

export function App() {
	return (
		<>
			<a className="skip" href="#try">ข้ามไปที่ทดลองใช้</a>
			<header className="topbar">
				<div className="wrap topbar-inner">
					<a className="brand" href="#top">
						<span className="brand-mark" aria-hidden="true">ที่</span>
						th-address-latent
					</a>
					<nav aria-label="สารบัญ">
						<a href="#try">ทดลองใช้</a>
						<a href="#results">ผลการวัด</a>
						<a href="#how">ทำงานอย่างไร</a>
						<a href="#use">ใช้กับงานไหน</a>
						<a href="#en" lang="en">EN</a>
					</nav>
				</div>
			</header>

			<main id="top">
				<section className="hero wrap">
					<div className="hero-copy">
						<p className="kicker">ตัวแยกที่อยู่จัดส่งภาษาไทย โอเพนซอร์ส</p>
						<h1>วางข้อความแชต<br />ได้ที่อยู่ครบเจ็ดช่อง</h1>
						<p className="lede">
							แยกชื่อผู้รับ เบอร์โทร ที่อยู่ ตำบล อำเภอ จังหวัด และรหัสไปรษณีย์ ออกจากข้อความที่ลูกค้าพิมพ์มาแบบไหนก็ได้
							ทำงานในเบราว์เซอร์ทั้งหมด
						</p>
						<ul className="claims">
							<li><strong>รันในเบราว์เซอร์</strong><span>ไม่มีเซิร์ฟเวอร์ ข้อมูลลูกค้าไม่ออกจากเครื่อง</span></li>
							<li><strong>เล็ก</strong><span>โมเดลกับฐานข้อมูลพื้นที่รวมราว {STATS.modelGzipKB + STATS.gazetteerGzipKB} KB เมื่อ gzip ไม่มี dependency</span></li>
							<li><strong>เร็ว</strong><span>ราว {STATS.parseMs.median} ms ต่อข้อความ<PlaceholderBadge /></span></li>
						</ul>
						<a className="btn" href="#try">ลองวางข้อความ</a>
					</div>
					<div className="hero-code">
						<p className="code-title">ใช้ในโค้ด TypeScript</p>
						<pre tabIndex={0}><code>{SNIPPET}</code></pre>
					</div>
				</section>

				<section id="try" className="band">
					<div className="wrap">
						<h2>ทดลองใช้</h2>
						<p className="section-lede">พิมพ์หรือวางข้อความ ผลจะเปลี่ยนตามทันที ลองเลือกตัวอย่างด้านล่างก็ได้</p>
						<Playground />
					</div>
				</section>

				<section id="results" className="wrap section">
					<h2>ผลการวัด <PlaceholderBadge /></h2>
					<Results />
				</section>

				<section id="how" className="band">
					<div className="wrap">
						<h2>ทำงานอย่างไร</h2>
						<ol className="steps">
							{STEPS.map((step, index) => (
								<li key={step.en}>
									<span className="step-no" aria-hidden="true">{index + 1}</span>
									<h3>{step.title} <span className="muted" lang="en">{step.en}</span></h3>
									<p>{step.body}</p>
								</li>
							))}
						</ol>
						<p><a href="explainer.html">อ่านคำอธิบายเชิงเทคนิคแบบละเอียด</a></p>
					</div>
				</section>

				<section id="use" className="wrap section">
					<h2>ใช้กับงานไหนได้บ้าง</h2>
					<div className="cards">
						{INDUSTRIES.map((item) => (
							<article className="card" key={item.title}>
								<h3>{item.title}</h3>
								<p>{item.body}</p>
							</article>
						))}
					</div>
				</section>

				<section id="limits" className="wrap section">
					<div className="split">
						<div>
							<h2>ข้อจำกัด</h2>
							<ul className="limits">
								{LIMITS.map((limit) => <li key={limit}>{limit}</li>)}
							</ul>
						</div>
						<div>
							<h2>โอเพนซอร์ส</h2>
							<p>
								โค้ด โมเดล และฐานข้อมูลพื้นที่เปิดให้ใช้และตรวจสอบได้ เขียนด้วย TypeScript
								ไม่มี dependency ตอนรันไทม์ ใช้ได้ทั้งในเบราว์เซอร์ Bun และ Node
							</p>
							{REPO_URL && <p><a className="btn btn-outline" href={REPO_URL}>ดูโค้ดบน GitHub</a></p>}
						</div>
					</div>
				</section>

				<section id="en" className="band" lang="en">
					<div className="wrap en">
						<h2>In English</h2>
						<p>
							th-address-latent extracts the seven shipping fields (name, phone, address detail, subdistrict,
							district, province, postcode) from a free-form Thai chat message. A small character-level tagger labels
							the text, constrained Viterbi decoding turns labels into spans, and a resolver snaps the
							administrative spans to one real tuple from a{" "}
							{STATS.datasets.gazetteerTuples.toLocaleString()}-entry gazetteer. It runs entirely in the
							browser with no runtime dependencies. On a sealed, reviewed synthetic holdout of
							{" "}{STATS.holdout.records.toLocaleString()} messages in 14 categories it gets
							{" "}{percent(STATS.holdout.exact / STATS.holdout.records)} of records exactly right across all
							seven fields{PLACEHOLDER ? " (placeholder figures)" : ""}. Thai addresses only, one address per
							message.
						</p>
					</div>
				</section>
			</main>

			<footer className="wrap footer">
				<span>th-address-latent</span>
				<a href="explainer.html">Explainer</a>
				{REPO_URL && <a href={REPO_URL}>Source</a>}
			</footer>
		</>
	);
}
