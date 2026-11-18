/** Prints the fields and notes for a few hand-written messages: the landmark-or-note cases. */
import { createTaggerParser, expandGazetteer, type CompactGazetteer, type NoteModel } from "../../src";
import type { AnyTaggerModel } from "../../src/tagger/model";
import gazetteer from "../../resources/gazetteer.json";
import model from "../../resources/tagger-model.json";

const notes = (await Bun.file(Bun.argv[2] ?? "resources/notes-model.json").json()) as NoteModel;
const parser = createTaggerParser(model as unknown as AnyTaggerModel, expandGazetteer(gazetteer as unknown as CompactGazetteer), { notes });

const MESSAGES = [
	"คุณสมชาย ใจดี 0891234567\n12 ม.4 ตรงข้ามร้านของชำป้าแดง ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\nวางของไว้หน้าประตูรั้วได้เลยค่ะ",
	"88 ม.2 ต.หนองบัว อ.เมือง จ.อุดรธานี 41000 คุณแดง 0812345678 บ้านอยู่ตรงข้ามร้านของชำ รั้วสีเขียว ถ้าไม่อยู่ฝากร้านของชำได้เลยค่ะ",
	"ส่งให้ น้องเมย์ 081-222-3333 บ้านเลขที่ 45/2 หมู่บ้านสุขใจ ซ.3 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540 เข้าทางประตูหลังหมู่บ้านนะคะ ประตูหน้าปิด",
	"สวัสดีค่ะแม่ค้า 🙏 เอาเสื้อสีครีม 2 ตัว ไซส์ M โอนแล้วนะคะ\nส่งให้ คุณมายด์ ศรีสุข ค่ะ\n88/14 ม.5 ซ.วัดป่า ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร\nโทร 089-123-4567 ฝากป้อมยามได้เลยค่ะ",
	"ร้านป้านิด 0861112222 99 ม.7 ต.ท่าช้าง อ.เมือง จ.จันทบุรี 22000 เก็บเงินปลายทางนะคะ ส่ง flash ค่ะ วันอาทิตย์ร้านปิด",
	"เอาปลาส้ม 3 ห่อค่ะ คุณบัว 0632221111 15 ม.3 ต.นาโพธิ์ อ.กุฉินารายณ์ กาฬสินธุ์ 46110 ขอบคุณค่ะ",
];

for (const message of MESSAGES) {
	const started = performance.now();
	const result = parser.parse(message);
	const ms = performance.now() - started;
	console.log(`---\n${message}\n  address: ${result.fields.address}\n  notes:   ${result.notes}\n  (${ms.toFixed(1)} ms)`);
}
