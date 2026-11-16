import type { ExpectedAddress } from "./dataset";

export const FIELD_NAMES = [
  "name",
  "phone",
  "address",
  "subdistrict",
  "district",
  "province",
  "zipcode",
] as const satisfies readonly (keyof ExpectedAddress)[];

export interface MetricAccumulator {
  records: number;
  exactRecords: number;
  failures: number;
  fields: Record<keyof ExpectedAddress, { correct: number; total: number }>;
}

export interface ExactAcceptance {
	readonly minimumAccuracy: number;
	readonly requiredExactRecords: number;
	readonly actualExactRecords: number;
	readonly passed: boolean;
}

export function exactAcceptance(
	metrics: Pick<MetricAccumulator, "records" | "exactRecords">,
	minimumAccuracy: number,
): ExactAcceptance {
	if (
		!Number.isFinite(minimumAccuracy) ||
		minimumAccuracy < 0 ||
		minimumAccuracy > 1
	) {
		throw new Error("minimum exact-record accuracy must be between zero and one");
	}
	const requiredExactRecords = Math.ceil(metrics.records * minimumAccuracy);
	return {
		minimumAccuracy,
		requiredExactRecords,
		actualExactRecords: metrics.exactRecords,
		passed: metrics.exactRecords >= requiredExactRecords,
	};
}

export function createMetrics(): MetricAccumulator {
  return {
    records: 0,
    exactRecords: 0,
    failures: 0,
    fields: Object.fromEntries(
      FIELD_NAMES.map((field) => [field, { correct: 0, total: 0 }]),
    ) as MetricAccumulator["fields"],
  };
}

export function addResult(
  metrics: MetricAccumulator,
  expected: ExpectedAddress,
  actual: ExpectedAddress | null,
): void {
  addRecipients(metrics, [expected], actual ? [actual] : null);
}

/**
 * Scores one message with any number of deliveries. Fields are compared per
 * recipient in written order, a missing recipient counting as all null, and
 * the message is exact only when every recipient matches.
 */
export function addRecipients(
  metrics: MetricAccumulator,
  expected: readonly ExpectedAddress[],
  actual: readonly ExpectedAddress[] | null,
): void {
  metrics.records += 1;
  if (!actual) {
    metrics.failures += 1;
    for (const field of FIELD_NAMES) metrics.fields[field].total += expected.length;
    return;
  }
  let exact = expected.length === actual.length;
  for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
    const want = expected[index];
    const got = actual[index];
    for (const field of FIELD_NAMES) {
      const fieldMetric = metrics.fields[field];
      fieldMetric.total += 1;
      if ((got ? got[field] : null) === (want ? want[field] : null)) fieldMetric.correct += 1;
      else exact = false;
    }
  }
  if (exact) metrics.exactRecords += 1;
}

export function summarize(metrics: MetricAccumulator): object {
  return {
    records: metrics.records,
    exactRecords: metrics.exactRecords,
    exactRecordAccuracy: metrics.records === 0 ? 0 : metrics.exactRecords / metrics.records,
    failures: metrics.failures,
    failureRate: metrics.records === 0 ? 0 : metrics.failures / metrics.records,
    fields: Object.fromEntries(
      FIELD_NAMES.map((field) => {
        const value = metrics.fields[field];
        return [field, {
          correct: value.correct,
          total: value.total,
          accuracy: value.total === 0 ? 0 : value.correct / value.total,
        }];
      }),
    ),
  };
}
