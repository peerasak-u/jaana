export interface Range {
	readonly start: number;
	readonly end: number;
}

/** Which characters are the recipient name and which organisations are part of the address. */
export interface Recipient {
	readonly name: Range | null;
	readonly address: readonly Range[];
}

/** Only spaces, brackets, or a slash on one line join an organisation and a person into one name. */
const JOINER = /^[ \t ()[\]/]*$/u;

/** A bracket opened after the left part and still open where the right part starts, as in `บจก.เอ (attn. คุณบี)`. */
const INSIDE_BRACKET = /^[ \t ]*\([^()\n]*$/u;

function joins(raw: string, left: Range, right: Range): boolean {
	if (left.end > right.start) return false;
	const gap = raw.slice(left.end, right.start);
	return JOINER.test(gap) || INSIDE_BRACKET.test(gap);
}

/** Whether two ranges are written next to each other in the sense of the recipient rule. */
export function nextTo(raw: string, one: Range, other: Range): boolean {
	return joins(raw, one, other) || joins(raw, other, one);
}

function closeBracket(raw: string, range: Range): Range {
	const text = raw.slice(range.start, range.end);
	const open = (text.match(/\(/gu) ?? []).length - (text.match(/\)/gu) ?? []).length;
	if (open < 0 && text.endsWith(")")) return { start: range.start, end: range.end - 1 };
	if (open <= 0) return range;
	const close = /^[ \t]*\)/u.exec(raw.slice(range.end));
	return close ? { start: range.start, end: range.end + close[0].length } : range;
}

/** A label the GUIDE keeps out of the name, written as its own word before it. */
const LEADING_LABEL = /^(?:(?:ตอบ|จริง|ชื่อจริง|ชื่อ|ผู้รับ|ส่งให้|ถึง|c\/o|To|recipient)[\s:：]+|[^\s:：()]+[ \t]*[:：][ \t]*|(?:ผม|ดิฉัน)(?=[ก-๎]))/iu;
/** A particle the GUIDE keeps out of the name, written as its own word after it. */
const TRAILING_PARTICLE = /\s+(?:นะ|ค่ะ|คะ|ครับ|จ้า|จ้ะ|นะคะ|นะครับ|นะจ้ะ|นะจ๊ะ|ด้วยนะ|ด้วย|ด้วยค่ะ|ด้วยครับ)$/u;

/** The rest of `ชื่อเล่น` when the tagger starts the name after `ชื่อ`. */
const NICKNAME_REST = /^เล่น[\s:：]*(?:คือ[\s:：]*)?/u;

/** A nickname after its label, as `ชื่อเล่นคือต้อมครับ`, without the particle glued to it. */
const LABELLED_NICKNAME = /ชื่อเล่น[ \t]*(?:คือ)?[ \t:：]*([ก-๎A-Za-z]+?)(?:นะคะ|นะครับ|ครับ|ค่ะ|คะ|จ้า|นะ)?(?![ก-๎A-Za-z])/du;

/**
 * One short word after the label `ชื่อ` or `ชื่อจริง`, as `ส่งให้เพื่อนชื่อ เตย นะ`, that
 * ends the phrase: a particle, a number, or the line's end follows it. The
 * label opens its word or follows the person it names (`เพื่อน`, `น้อง`, ...),
 * so `ใส่ชื่อ` and `ไลน์ชื่อ` are not it; Thai writes no spaces, so a long
 * run after it is a sentence, as `ชื่อ: ใช้ชื่อในไลน์ได้เลยค่ะ`.
 */
const LABELLED_WORD = /(?<=^|[\s:：,(]|เพื่อน|น้อง|พี่|แม่|พ่อ|ลูก|หลาน|ป้า|ลุง|น้า|ยาย|ผู้รับ|คนรับ)ชื่อ(?:จริง)?[ \t]*[ \t:：][ \t]*(?!บริษัท|ร้าน|บ้าน|หจก|บจก)([ก-๎A-Za-z]{1,12}?)(?:นะคะ|นะครับ|ครับ|ค่ะ|คะ|จ้า)?(?=[ \t]*(?:$|\n|[0-9๐-๙]|(?:นะ|ค่ะ|คะ|ครับ|จ้า)(?![ก-๎])))/diu;

/** Where the nickname after the label `ชื่อเล่น` is written, if anywhere, else a one-word name after `ชื่อ`. */
export function labelledNickname(raw: string): Range | null {
	const group = (LABELLED_NICKNAME.exec(raw) ?? LABELLED_WORD.exec(raw))?.indices?.[1];
	return group ? { start: group[0], end: group[1] } : null;
}

/** A person written with an honorific, then a department with no organisation, as `คุณกฤษดา ฝ่ายไอที`. */
const PERSON_DEPARTMENT = /^((?:คุณ|นาย|นางสาว|นาง|น\.ส\.|ดร\.)[^\s()]+(?:[ \t]+[^\s()]+)?)[ \t]+(?:ฝ่าย|แผนก)[^\s()]*$/u;

/** The GUIDE keeps a department written next to a person, with no organisation, out of the name. */
function withoutDepartment(raw: string, range: Range): Range {
	const person = PERSON_DEPARTMENT.exec(raw.slice(range.start, range.end))?.[1];
	return person ? { start: range.start, end: range.start + person.length } : range;
}

/**
 * A branch designation written after a company outside brackets, as
 * `บริษัท เอ จำกัด สำนักงานใหญ่` or `สาขาที่ 00002`, is a tax-invoice note the GUIDE
 * leaves out of the name. A named branch, as `สาขาอโศก`, stays.
 */
const TRAILING_BRANCH = /[ \t]+(?:สำนักงานใหญ่|สนญ\.?|สาขา(?:ที่)?[ \t]*[0-9๐-๙]+)$/u;

function trimLabels(raw: string, range: Range): Range {
	const branch = TRAILING_BRANCH.exec(raw.slice(range.start, range.end));
	if (branch && branch.index > 0) range = { start: range.start, end: range.start + branch.index };
	const text = raw.slice(range.start, range.end);
	const nickname = raw.slice(0, range.start).endsWith("ชื่อ") ? NICKNAME_REST.exec(text)?.[0].length : undefined;
	const leading = nickname ?? LEADING_LABEL.exec(text)?.[0].length ?? 0;
	const trailing = TRAILING_PARTICLE.exec(text.slice(leading))?.[0].length ?? 0;
	if (leading + trailing >= text.length) return range;
	return { start: range.start + leading, end: range.end - trailing };
}

/**
 * Applies the recipient rule of `bench/chat/GUIDE.md` to the Tagger's
 * person (NAME) run and organisation (ORG) runs:
 *
 * | person | organisation                  | name                 | organisation goes to |
 * |--------|-------------------------------|----------------------|----------------------|
 * | yes    | next to it on the same line   | person + organisation | the name            |
 * | yes    | written apart                 | person               | the address          |
 * | no     | first one                     | that organisation    | the name             |
 * | no     | any later one apart from it   | first organisation   | the address          |
 */
export function composeRecipient(raw: string, person: Range | null, orgs: readonly Range[]): Recipient {
	const pending = [...orgs].sort((left, right) => left.start - right.start);
	let name = person ?? pending.shift() ?? null;
	if (!name) return { name: null, address: [] };
	let grew = true;
	while (grew) {
		grew = false;
		for (let index = 0; index < pending.length; index += 1) {
			const org = pending[index]!;
			if (!nextTo(raw, name, org)) continue;
			name = { start: Math.min(name.start, org.start), end: Math.max(name.end, org.end) };
			pending.splice(index, 1);
			grew = true;
			break;
		}
	}
	if (person && name === person) name = withoutDepartment(raw, name);
	return { name: closeBracket(raw, trimLabels(raw, name)), address: pending };
}
