import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMeridianDataset, recordsToCsv } from '../tests/fixtures/meridian.ts';
import { buildUploadRequest, parseCsv, type UploadState } from '../lib/data-lab.ts';
import { reconcile, type ReconciliationResult } from '../lib/reconciliation.ts';
import { POST } from '../app/api/v1/reconcile/route.ts';

const count = Number(process.argv[2] ?? 12_000);
const fixture = createMeridianDataset(count);
const {without_proof_truth, ...input} = fixture;
const uploads: UploadState = {};
for (const [source,rows] of Object.entries(input)) uploads[source as keyof UploadState] = parseCsv(recordsToCsv(rows));
const request = buildUploadRequest(uploads);
const local = reconcile(request);
assert.equal(local.metrics.input_records,count * 4);
assert.equal(local.metrics.processed_records,count * 5);
assert.equal(local.metrics.matched_pairs,count * 1.6);
assert.equal(local.metrics.input_resolution_rate,0.8);
assert.equal(local.metrics.precision,1);
assert.equal(local.metrics.recall,1);
assert.equal(local.metrics.silent_drops,0);
assert.equal(local.verification.status,'PASS');
const blind = reconcile({...request,ground_truth:undefined});
assert.deepEqual(blind.matches,local.matches);
assert.equal(blind.metrics.precision,null);
assert.equal(blind.verification.receipt_sha256,local.verification.receipt_sha256);
const noProof = reconcile({...request,settlement_recon_items:undefined,ground_truth:without_proof_truth});
assert.equal(noProof.metrics.matched_pairs,count * 1.65);
assert.equal(noProof.metrics.precision,1);
assert.equal(noProof.metrics.recall,1);
const started = performance.now();
const response = await POST(new Request('http://localhost/api/v1/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}));
const api = await response.json() as ReconciliationResult & {truncated:{matches:number;exceptions:number;settlement_closures:number}};
const roundTrip = performance.now() - started;
assert.equal(response.status,200);
assert.equal(api.metrics.matched_pairs,local.metrics.matched_pairs);
assert.equal(api.verification.receipt_sha256,local.verification.receipt_sha256);
if (request.response_mode === 'summary') {
  assert.equal(api.matches.length + api.truncated.matches,local.matches.length);
  assert.equal(api.exceptions.length + api.truncated.exceptions,local.exceptions.length);
}
const report = {
  dataset:'Meridian',seed:9072026,engine:local.engine_version,source_rows_each:count,
  primary_records:local.metrics.input_records,processed_records:local.metrics.processed_records,
  matched_pairs:local.matches.length,exceptions:local.exceptions.length,
  review:local.metrics.review_records,blocked:local.metrics.blocked_records,
  input_resolution_rate:local.metrics.input_resolution_rate,precision:local.metrics.precision,recall:local.metrics.recall,
  false_auto_match_rate:local.metrics.false_auto_match_rate,silent_drops:local.metrics.silent_drops,
  engine_including_verification_ms:local.metrics.duration_ms,
  api_including_encoding_ms:roundTrip,receipt:local.verification.receipt_sha256,
  evaluated_paths:['CSV parser → Data lab request → engine','blind labels','withheld settlement proof','versioned API → summary → receipt'],
};
if (process.argv.includes('--export')) {
  const output = resolve('outputs/meridian');
  await mkdir(output,{recursive:true});
  for (const [source,rows] of Object.entries(input)) await writeFile(resolve(output,`${source}.csv`),recordsToCsv(rows));
  await writeFile(resolve(output,'request.json'),JSON.stringify(request));
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  await writeFile(resolve(output,'without-proof-ground-truth.json'),JSON.stringify(without_proof_truth));
}
console.log(JSON.stringify(report,null,2));
