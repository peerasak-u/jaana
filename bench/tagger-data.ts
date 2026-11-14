import { TAGS } from "../src/tagger/model";
import { loadDatasets, type DatasetRecord } from "./dataset";
import { splitForTraining, type TrainingDatasetSplit } from "./split";

export const SPLIT_SEED = "20260720";

export function goldTags(record: DatasetRecord): Uint8Array {
	const tags = new Uint8Array(record.raw.length);
	for (const span of record.spans) {
		const tag = TAGS.indexOf(span.label);
		if (tag <= 0) continue;
		let start = span.start;
		let end = span.end;
		while (start < end && /\s/u.test(record.raw[start]!)) start += 1;
		while (end > start && /\s/u.test(record.raw[end - 1]!)) end -= 1;
		tags.fill(tag, start, end);
	}
	return tags;
}

function locationKey(record: DatasetRecord): string {
	const location = record.seedLocation;
	return [location.subdistrict, location.district, location.province, location.zipcode].join("\u0000");
}

export interface TaggerPartitions {
	readonly split: TrainingDatasetSplit;
	readonly extraTrain: readonly DatasetRecord[];
	readonly extraDropped: number;
}

/**
 * Splits the base datasets exactly as the engine benchmark does. Extra
 * datasets are train-only and lose every record that shares a location
 * tuple or template family with development or evaluation, or that its
 * generator declared as evaluation.
 */
export async function loadTaggerPartitions(
	datasetPaths: readonly string[],
	extraDatasetPaths: readonly string[],
): Promise<TaggerPartitions> {
	const split = splitForTraining(await loadDatasets(datasetPaths), SPLIT_SEED);
	const heldOut = [...split.development, ...split.evaluation];
	const heldOutLocations = new Set(heldOut.map(locationKey));
	const heldOutFamilies = new Set(
		heldOut.map((record) => record.partition.templateFamily).filter((family) => family !== undefined),
	);
	const extra = extraDatasetPaths.length === 0 ? [] : await loadDatasets(extraDatasetPaths);
	const extraTrain = extra.filter((record) =>
		!heldOutLocations.has(locationKey(record)) &&
		record.partition.declaredSplit !== "evaluation" &&
		(record.partition.templateFamily === undefined ||
			!heldOutFamilies.has(record.partition.templateFamily)),
	);
	return { split, extraTrain, extraDropped: extra.length - extraTrain.length };
}
