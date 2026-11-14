export const LABELS = [
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
	"OTHER",
] as const;

export type Label = (typeof LABELS)[number];
export type OutputLabel = Exclude<Label, "OTHER">;
export type FieldName =
	| "name"
	| "phone"
	| "address"
	| "subdistrict"
	| "district"
	| "province"
	| "zipcode";

export interface LocationTuple {
	readonly subdistrict: string;
	readonly district: string;
	readonly province: string;
	readonly zipcode: string;
}

export type CandidateSource =
	| "recipient"
	| "structured"
	| "phone"
	| "postcode"
	| "administrative"
	| "gazetteer"
	| "segment";

export interface ParserResources {
	readonly version: string;
	readonly locations: readonly LocationTuple[];
}

export interface ParserOptions {
	readonly beamWidth?: number;
	readonly candidatesPerLabel?: number;
	readonly minFieldConfidence?: number;
	readonly diagnostics?: "summary" | "full";
}

export interface ParsedFields {
	readonly name: string | null;
	readonly phone: string | null;
	readonly address: string | null;
	readonly subdistrict: string | null;
	readonly district: string | null;
	readonly province: string | null;
	readonly zipcode: string | null;
}

export interface ParsedSpan {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly confidence: number;
}

export interface Abstention {
	readonly field: FieldName;
	readonly reason:
		| "invalid-offset"
		| "low-confidence"
		| "invalid-format"
		| "inconsistent-location";
}

export interface ParseDiagnostics {
	readonly resourceVersion: string;
	readonly candidatesEvaluated: number;
	readonly hypothesesEvaluated: number;
	readonly scoreSemantics: "uncalibrated-selection-score";
	readonly candidateTrace?: readonly CandidateTrace[];
	readonly candidateRejections?: readonly CandidateRejection[];
}

export interface CandidateRejection {
	readonly label: OutputLabel;
	readonly text: string;
	readonly start: number;
	readonly end: number;
	readonly ruleId: string;
}

export interface EvidenceContribution {
	readonly ruleId: string;
	readonly effect: "base" | "add" | "floor" | "reject" | "resolve";
	readonly value: number;
}

export interface CandidateTrace {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly evidenceScore: number;
	readonly score: number;
	readonly source?: CandidateSource;
	readonly evidence: readonly EvidenceContribution[];
	readonly outcome: "accepted" | "pruned" | "abstained";
	readonly reason?:
		| Abstention["reason"]
		| "below-threshold"
		| "overlap"
		| "lower-ranked"
		| "beam-pruned";
}

export interface ParseResult {
	readonly raw: string;
	readonly fields: ParsedFields;
	readonly spans: readonly ParsedSpan[];
	readonly confidence: number;
	readonly abstentions: readonly Abstention[];
	readonly diagnostics: ParseDiagnostics;
}

export interface AddressParser {
	parse(raw: string): ParseResult;
}

export interface Candidate {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly evidenceScore: number;
	readonly score: number;
	readonly source?: CandidateSource;
	readonly locationIds: readonly number[];
	readonly evidence: readonly EvidenceContribution[];
}

export interface DecodeResult {
	readonly selected: readonly Candidate[];
	readonly score: number;
	readonly hypothesesEvaluated: number;
}
