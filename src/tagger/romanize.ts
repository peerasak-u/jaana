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

/** Romanized subdistrict prefixes, which the Thai name never carries. */
const LATIN_PREFIX = /^(?:tambon|t\.|khwaeng|kwaeng|sub-?district)\s*/iu;

export function latinSkeleton(text: string): string {
	const letters = text.trim().replace(LATIN_PREFIX, "").toLowerCase().replace(/ng/gu, "G").replace(/[^a-zG]/gu, "");
	return dropGlides([...letters].map((letter) => (letter === "G" ? "G" : LATIN_CLASS.get(letter) ?? "")).join(""));
}
