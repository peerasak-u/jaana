import type { LocationTuple } from "../src/types";
import { AUGMENT_OPS, augmentChatRecords, type AugmentOp } from "./chat/augment";
import { loadChatPool } from "./chat/load";
import { fnv1a, poolOf } from "./chat/markup";
import type { DatasetRecord } from "./dataset";
import { loadTaggerPartitions, type TaggerPartitions } from "./tagger-data";

export interface TrainingRecordOptions {
	readonly datasetPaths: readonly string[];
	readonly extraPaths: readonly string[];
	readonly locations: readonly LocationTuple[];
	readonly withChat: boolean;
	readonly chatPercent: number;
	/** Copies of each chat record, the record itself included. */
	readonly augment: number;
	readonly augmentOps: readonly AugmentOp[];
	readonly seed: number;
}

export interface TrainingRecords {
	readonly partitions: TaggerPartitions;
	readonly records: readonly DatasetRecord[];
	readonly chatRecords: number;
	readonly benchPoolDropped: number;
}

/**
 * The tagger's training set: the synthetic train partition and extra
 * datasets, plus the augmented chat train pool. With chat, synthetic records
 * seeded on a bench-pool location are dropped.
 */
export async function loadTrainingRecords(options: TrainingRecordOptions): Promise<TrainingRecords> {
	for (const op of options.augmentOps) if (!AUGMENT_OPS.includes(op)) throw new Error(`unknown augment op ${op}`);
	const partitions = await loadTaggerPartitions(options.datasetPaths, options.extraPaths);
	const loadedChat = options.withChat ? await loadChatPool("train", options.locations) : { records: [], issues: [] };
	if (loadedChat.issues.length > 0) throw new Error(`${loadedChat.issues.length} chat source issues. Run scripts/chat/check.ts`);
	const sampledChat = loadedChat.records.filter((record) => fnv1a(record.id) % 100 < options.chatPercent);
	const chat = augmentChatRecords(sampledChat, {
		copies: options.augment - 1,
		seed: options.seed,
		ops: options.augmentOps,
		locations: options.locations.filter((location) => poolOf(location) === "train"),
	});
	const synthetic = [...partitions.split.train, ...partitions.extraTrain];
	const records = options.withChat
		? [...synthetic.filter((record) => poolOf(record.seedLocation) !== "bench"), ...chat]
		: synthetic;
	return {
		partitions,
		records,
		chatRecords: chat.length,
		benchPoolDropped: synthetic.length + chat.length - records.length,
	};
}
