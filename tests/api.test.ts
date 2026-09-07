import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET, OPTIONS, POST } from '../app/api/v1/reconcile/route.ts';
import { POST as legacyPost } from '../app/api/reconcile/route.ts';
import { ENGINE_VERSION, type ReconciliationResult } from '../lib/reconciliation.ts';
import { createBenchmarkDataset } from '../lib/benchmark.ts';

const data = {payments:[{id:'pay_api',invoice_id:'inv_api',amount:100,status:'captured'}],invoices:[{id:'inv_api',amount:100}]};
const request = (payload:unknown,headers:Record<string,string> = {}) => new Request('http://localhost/api/v1/reconcile',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
type ApiResponse = ReconciliationResult & {truncated:{matches:number;exceptions:number;settlement_closures:number}};
const readBody = (response:Response) => response.json() as Promise<ApiResponse>;

test('versioned and legacy APIs expose the real engine with matching receipt headers', async () => {
  assert.equal(POST,legacyPost);
  const response = await POST(request(data));
  assert.equal(response.status,200);
  const body = await readBody(response);
  assert.equal(body.metrics.matched_pairs,1);
  assert.equal(body.metrics.precision,null);
  assert.equal(response.headers.get('X-Verification-Receipt'),body.verification.receipt_sha256);
  assert.equal(response.headers.get('X-Engine-Version'),ENGINE_VERSION);
  assert.equal(OPTIONS().status,204);
  assert.match(JSON.stringify(await GET(new Request('http://localhost')).json()),/no durable replay cache/);
});

test('invalid requests return typed errors without releasing decisions', async () => {
  for (const payload of [null,[],{}, {payments:{}}, {payments:[null]}, {...data,ground_truth:[{}]}, {...data,ground_truth:[{left_id:' ',right_id:'inv_api'}]}, {...data,response_mode:'magic'}]) {
    const response = await POST(request(payload));
    assert.equal(response.status,400,JSON.stringify(payload));
    assert.equal((await response.json() as {matches?:unknown}).matches,undefined);
  }
  assert.equal((await POST(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'}))).status,400);
  assert.equal((await POST(request(data,{'Content-Type':'text/plain'}))).status,415);
  assert.equal((await POST(request({...data,options:{auto_match_threshold:1}}))).status,422);
  assert.equal((await POST(request(data,{'Idempotency-Key':'has space'}))).status,400);
});

test('API authentication works when configured, including empty supplied keys', async (t) => {
  const prior = process.env.CLOSEPILOT_API_KEY;
  process.env.CLOSEPILOT_API_KEY = 'test-only-key';
  t.after(() => { if (prior === undefined) delete process.env.CLOSEPILOT_API_KEY; else process.env.CLOSEPILOT_API_KEY = prior; });
  assert.equal((await POST(request(data))).status,401);
  assert.equal((await POST(request(data,{'X-API-Key':'wrong'}))).status,401);
  assert.equal((await POST(request(data,{'X-API-Key':'test-only-key'}))).status,200);
});

test('stable run labels bind to facts and never reuse old results for changed facts', async () => {
  const first = await readBody(await POST(request(data,{'Idempotency-Key':'same-run'})));
  const repeated = await readBody(await POST(request(data,{'Idempotency-Key':'same-run'})));
  assert.equal(first.run_id,repeated.run_id);
  assert.equal(first.verification.receipt_sha256,repeated.verification.receipt_sha256);
  const changed = await readBody(await POST(request({...data,payments:[{...data.payments[0],status:'failed'}]},{'Idempotency-Key':'same-run'})));
  assert.notEqual(changed.run_id,first.run_id);
  assert.equal(changed.matches.length,0);
});

test('streaming body limit cancels oversized bodies even without Content-Length', async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit & {duplex:string});
  assert.equal((await POST(streamed)).status,413);
  assert.equal(cancelled,true);
  assert.ok(chunks <= 23);
  assert.equal((await POST(request(data,{'Content-Length':String(21 * 1024 * 1024)}))).status,413);
});

test('summary responses preserve full-batch accounting while bounding every decision collection', async () => {
  const batch = createBenchmarkDataset(20);
  assert.equal((await POST(request(batch))).status,413);
  const response = await POST(request({...batch,response_mode:'summary'}));
  assert.equal(response.status,200);
  const body = await readBody(response);
  assert.equal(body.metrics.processed_records,26500);
  assert.equal(body.metrics.matched_pairs,9600);
  assert.equal(body.metrics.exception_records,800);
  assert.equal(body.matches.length,100);
  assert.equal(body.exceptions.length,100);
  assert.equal(body.matches.length + body.truncated.matches,body.metrics.matched_pairs);
  assert.equal(body.exceptions.length + body.truncated.exceptions,body.metrics.exception_records);
});

test('published OpenAPI metric keys and engine version agree with a real API response', async () => {
  const spec = JSON.parse(readFileSync(new URL('../public/openapi.json',import.meta.url),'utf8'));
  const body = await readBody(await POST(request(data)));
  assert.equal(spec.info.version,body.engine_version);
  const schema = spec.components.schemas.ReconciliationMetrics;
  for (const key of Object.keys(body.metrics)) assert.ok(key in schema.properties,`undocumented metric: ${key}`);
  for (const key of schema.required) assert.ok(key in body.metrics,`missing required metric: ${key}`);
});
