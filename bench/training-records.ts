import type { LocationTuple } from "../src/types";
import { AUGMENT_OPS, augmentChatRecords, type AugmentOp } from "./chat/augment";
import { loadChatPool } from "./chat/load";
import { fnv1a, isHoldout, poolOf, splitOf } from "./chat/markup";
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
 * seeded on a bench-pool location are dropped. CHAT_BENCH_FOLD=dev|test|all
 * also folds that part of the first bench batch in, which spends it as a
 * measurement. `all` is the shipping build: it also trains on every
 * gazetteer location, since the gazetteer is public and the parser reads it
 * at parse time anyway. Holdout messages are never folded.
 */
export async function loadTrainingRecords(options: TrainingRecordOptions): Promise<TrainingRecords> {
	for (const op of options.augmentOps) if (!AUGMENT_OPS.includes(op)) throw new Error(`unknown augment op ${op}`);
	const partitions = await loadTaggerPartitions(options.datasetPaths, options.extraPaths);
	const loadedChat = options.withChat ? await loadChatPool("train", options.locations) : { records: [], issues: [] };
	if (loadedChat.issues.length > 0) throw new Error(`${loadedChat.issues.length} chat source issues. Run scripts/chat/check.ts`);
	const fold = options.withChat ? (process.env.CHAT_BENCH_FOLD ?? "") : "";
	if (!["", "dev", "test", "all"].includes(fold)) throw new Error(`unknown CHAT_BENCH_FOLD ${fold}`);
	const loadedBench = fold === "" ? { records: [], issues: [] } : await loadChatPool("bench", options.locations);
	const folded = loadedBench.records.filter(
		(record) => !isHoldout(record) && (fold === "all" || splitOf(record.raw) === fold),
	);
	const sampledChat = [
		...loadedChat.records.filter((record) => fnv1a(record.id) % 100 < options.chatPercent),
		...folded,
	];
	const chat = augmentChatRecords(sampledChat, {
		copies: options.augment - 1,
		seed: options.seed,
		ops: options.augmentOps,
		locations: fold === "all" ? options.locations : options.locations.filter((location) => poolOf(location) === "train"),
	});
	const synthetic = [...partitions.split.train, ...partitions.extraTrain];
	const records = options.withChat
		? [...synthetic.filter((record) => fold === "all" || poolOf(record.seedLocation) !== "bench"), ...chat]
		: synthetic;
	return {
		partitions,
		records,
		chatRecords: chat.length,
		benchPoolDropped: synthetic.length + chat.length - records.length,
	};
}
