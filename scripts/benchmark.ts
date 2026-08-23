import { createBenchmarkDataset } from '../lib/benchmark.ts';
import { reconcile } from '../lib/reconciliation.ts';

const scale = Math.max(1, Number(process.argv[2] ?? 100));
const dataset = createBenchmarkDataset(scale);
const result = reconcile(dataset);
const summary = {
  primary_records: result.metrics.input_records,
  settlement_recon_items:result.metrics.settlement_recon_items,
  processed_records:result.metrics.processed_records,
  matched_pairs: result.metrics.matched_pairs,
  exceptions: result.metrics.exception_records,
  match_rate: `${(result.metrics.match_rate * 100).toFixed(2)}%`,
  precision: result.metrics.precision,
  recall: result.metrics.recall,
  false_auto_match_rate: result.metrics.false_auto_match_rate,
  duration_ms: Number(result.metrics.duration_ms.toFixed(2)),
  throughput_records_per_second: Math.round(result.metrics.throughput_records_per_second),
  silent_drops: result.metrics.silent_drops,
};
console.log(JSON.stringify(summary, null, 2));
