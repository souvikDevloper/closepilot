import assert from 'node:assert/strict';
import { createBenchmarkDataset } from '../lib/benchmark.ts';
import type { ReconciliationResult } from '../lib/reconciliation.ts';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3011').origin;
const request = (path:string, init:RequestInit = {}) => fetch(`${base}${path}`, {
  ...init, signal: AbortSignal.timeout(60_000),
});
for (const path of ['/', '/api/health', '/openapi.json', '/api/v1/reconcile']) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} must be publicly reachable`);
  if (path === '/') assert.match(await response.text(), /Reconciliation overview/);
  if (path === '/api/health') assert.match(await response.text(), /3\.1\.0/);
}
const fixture = createBenchmarkDataset();
const send = (payload:unknown) => request('/api/v1/reconcile', {
  method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':'release-smoke'},
  body:JSON.stringify(payload),
});
const response = await send(fixture);
assert.equal(response.status,200);
const scored = await response.json() as ReconciliationResult;
assert.equal(scored.engine_version,'3.1.0');
assert.equal(scored.metrics.input_records,1000);
assert.equal(scored.metrics.matched_pairs,480);
assert.equal(scored.metrics.exception_records,40);
assert.equal(scored.metrics.precision,1);
assert.equal(scored.verification.status,'PASS');
const blindResponse = await send({...fixture,ground_truth:undefined});
assert.equal(blindResponse.status,200);
const blind = await blindResponse.json() as ReconciliationResult;
assert.equal(blind.metrics.precision,null);
assert.equal(blind.metrics.recall,null);
assert.equal(blind.metrics.matched_pairs,480);
assert.equal(blind.verification.receipt_sha256,scored.verification.receipt_sha256);
const invalid = await request('/api/v1/reconcile', {
  method:'POST',headers:{'Content-Type':'application/json'},body:'{"payments":',
});
assert.equal(invalid.status,400);
console.log(JSON.stringify({base,checks:'PASS',engine:scored.engine_version,
  primary_records:1000,matched_pairs:480,exceptions:40,
  labelled_precision:scored.metrics.precision,blind_precision:blind.metrics.precision,
  receipt:scored.verification.receipt_sha256,invalid_json_status:invalid.status},null,2));
