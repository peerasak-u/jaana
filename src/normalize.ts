import type { OutputLabel } from "./types";

function asciiDigits(value: string): string {
	return value.replace(/[๐-๙]/gu, (digit) =>
		String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)),
	);
}

function phoneDigits(value: string): string {
	return asciiDigits(value).replace(/\D/g, "").replace(/^(0066|66)0?/u, "0");
}

export function normalizePhone(value: string): string | null {
	const digits = phoneDigits(value);
  return /^0\d{8,9}$/.test(digits) ? digits : null;
}

/**
 * The digits of a Thai number as the customer typed them, also when they
 * typed a digit or two too many or too few. Null for anything longer, such
 * as a 13-digit tax ID, or without a Thai area or mobile prefix.
 */
export function typedPhone(value: string): string | null {
	const digits = phoneDigits(value);
	return /^0[2-9]\d{7,10}$/.test(digits) ? digits : null;
}

export function normalizePostcode(value: string): string | null {
	const digits = asciiDigits(value).replace(/\D/g, "");
  return /^\d{5}$/.test(digits) ? digits : null;
}

export function normalizeCandidate(label: OutputLabel, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (label === "PHONE") return normalizePhone(trimmed);
  if (label === "POSTCODE") return normalizePostcode(trimmed);
  return trimmed.replace(/\s+/gu, " ");
}
