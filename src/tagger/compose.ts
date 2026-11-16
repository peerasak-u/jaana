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

function trimLabels(raw: string, range: Range): Range {
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
	return { name: closeBracket(raw, trimLabels(raw, name)), address: pending };
}
