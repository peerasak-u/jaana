/**
 * Consonant skeletons that let a romanized name be compared with a Thai
 * one: each side keeps only its consonant sounds, folded into classes that
 * romanization blurs (aspiration, voicing, r and l). Vowels, tone marks, and
 * a w or y after the first sound are dropped, since romanization writes
 * them as vowels (`แก้ว` Kaeo, `ไทย` Thai).
 */

const THAI_CLASS = new Map<string, string>(
	(
		[
			["กขฃคฅฆ", "K"],
			["ง", "G"],
			["จฉชฌ", "C"],
			["ซศษส", "S"],
			["ญย", "Y"],
			["ฎฏดตฐฑฒถทธ", "T"],
			["ณน", "N"],
			["บปผพภ", "P"],
			["ฝฟ", "F"],
			["มำ", "M"],
			["รลฬฤ", "L"],
			["ว", "W"],
		] as const
	).flatMap(([letters, sound]) => [...letters].map((letter) => [letter, sound] as const)),
);

const LATIN_CLASS = new Map<string, string>(
	(
		[
			["kgq", "K"],
			["cj", "C"],
			["sz", "S"],
			["y", "Y"],
			["td", "T"],
			["n", "N"],
			["bp", "P"],
			["f", "F"],
			["m", "M"],
			["rl", "L"],
			["wv", "W"],
		] as const
	).flatMap(([letters, sound]) => [...letters].map((letter) => [letter, sound] as const)),
);

function dropGlides(sounds: string): string {
	return sounds.slice(0, 1) + sounds.slice(1).replace(/[WY]/gu, "");
}

export function thaiSkeleton(name: string): string {
	return dropGlides([...name].map((letter) => THAI_CLASS.get(letter) ?? "").join(""));
}

/** Romanized subdistrict and district prefixes, which the Thai name never carries. */
const LATIN_PREFIX = /^(?:(?:tambon|t\.|khwaeng|kwaeng|sub-?district)\s*|(?:kwang|khet|amphoe)\s+)/iu;

export function latinSkeleton(text: string): string {
	const letters = text.trim().replace(LATIN_PREFIX, "").toLowerCase().replace(/ng/gu, "G").replace(/[^a-zG]/gu, "");
	return dropGlides([...letters].map((letter) => (letter === "G" ? "G" : LATIN_CLASS.get(letter) ?? "")).join(""));
}

const QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const KEDMANEE = "ๆไำพะัีรนยบลฟหกดเ้่าสวงผปแอิืทมใฝ";
const KEDMANEE_KEY = new Map([...QWERTY].map((key, index) => [key, KEDMANEE[index]!] as const));
/** Punctuation keys that type Thai letters, which a romanized name never holds mid-word. */
const THAI_LETTER_KEY = /.[;[\]',./]./u;

function kedmaneeWord(word: string): string | null {
	const thai = [...word].map((key) => KEDMANEE_KEY.get(key) ?? "").join("");
	return thai.length === word.length && /^[ก-ฮเ-ไ][ก-๎]*$/u.test(thai) ? thai : null;
}

/**
 * The Thai a name means when it was typed on the English layout of a
 * Kedmanee keyboard, as `l;ylfu` for `สวัสดี`. Null unless one word holds
 * a punctuation key mid-word and every word is unshifted keys that give
 * Thai letters, so `Co.,` and `K.Jay` stay English.
 */
export function fromKedmanee(name: string): string | null {
	const words = name.split(" ");
	if (!words.some((word) => THAI_LETTER_KEY.test(word))) return null;
	const thai = words.map(kedmaneeWord);
	return thai.every((word) => word !== null) ? thai.join(" ") : null;
}
