import { createBenchmarkDataset } from '@/lib/benchmark.ts';
import { reconcile, type RawRecord, type ReconciliationInput } from '@/lib/reconciliation.ts';

export const runtime = 'edge';

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const FULL_RESPONSE_LIMIT = 20_000;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...cors, ...headers },
});

const arrays = (input: ReconciliationInput) => [input.payments, input.settlements, input.bank_transactions, input.invoices];

export function OPTIONS() {
  return new Response(null, { status:204, headers:cors });
}

export function GET(request: Request) {
  const endpoint = new URL(request.url).origin + '/api/reconcile';
  return json({
    name:'ClosePilot Reconciliation API',
    version:'2.0.0',
    endpoint,
    method:'POST',
    description:'Reconciles Razorpay payments with invoices and Razorpay settlements with bank transactions. All financial matches are confidence and ambiguity gated.',
    request:{
      payments:'Array<Record<string, unknown>>',
      invoices:'Array<Record<string, unknown>>',
      settlements:'Array<Record<string, unknown>>',
      bank_transactions:'Array<Record<string, unknown>>',
      ground_truth:'Optional Array<{left_id,right_id}> for measured precision/recall',
      response_mode:'Optional "full" (default) or "summary"',
    },
    headers:{ 'Idempotency-Key':'Optional stable key. Reusing it returns a stable run identifier for the same payload.' },
    limits:{ maximum_records:MAX_RECORDS, full_response_maximum_records:FULL_RESPONSE_LIMIT, maximum_body_bytes:MAX_BODY_BYTES },
    example:{
      payments:[{id:'pay_001',invoice_id:'inv_001',amount:12500,created_at:'2026-08-21T10:00:00Z'}],
      invoices:[{id:'inv_001',payment_id:'pay_001',amount:12500,date:'2026-08-21T10:01:00Z'}],
      ground_truth:[{left_id:'pay_001',right_id:'inv_001'}],
    },
    benchmark:{ request:{benchmark:true}, records:1000, includes_ground_truth:true },
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({error:'payload_too_large',message:`Request body exceeds ${MAX_BODY_BYTES} bytes.`},413);
  let body: unknown;
  try { body = await request.json(); }
  catch { return json({error:'invalid_json',message:'Body must be valid JSON.'},400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid_payload',message:'Body must be a JSON object.'},400);
  const envelope = body as ReconciliationInput & { benchmark?: boolean; benchmark_scale?: number; response_mode?: 'full'|'summary' };
  const input: ReconciliationInput = envelope.benchmark
    ? createBenchmarkDataset(Math.min(10, Math.max(1, Number(envelope.benchmark_scale ?? 1))))
    : envelope;
  if (arrays(input).some((value) => value !== undefined && !Array.isArray(value))) return json({error:'invalid_dataset',message:'Every supplied dataset must be an array of records.'},400);
  const total = arrays(input).reduce((sum, value) => sum + (value?.length ?? 0), 0);
  if (!total) return json({error:'empty_dataset',message:'Supply payments + invoices, settlements + bank_transactions, or {"benchmark":true}.'},400);
  if (total > MAX_RECORDS) return json({error:'record_limit_exceeded',message:`This endpoint accepts at most ${MAX_RECORDS.toLocaleString('en-IN')} records per batch. Shard larger jobs by merchant, currency and settlement date.`},413);
  if (envelope.response_mode !== 'summary' && total > FULL_RESPONSE_LIMIT) return json({error:'full_response_limit_exceeded',message:`Use response_mode:"summary" above ${FULL_RESPONSE_LIMIT.toLocaleString('en-IN')} records, or shard the batch.`},413);
  const rawArrays = arrays(input).flatMap((value) => value ?? []);
  if (rawArrays.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) return json({error:'invalid_record',message:'Every dataset entry must be a JSON object.'},400);

  try {
    const result = reconcile(input);
    const idempotencyKey = (request.headers.get('idempotency-key') ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32);
    if (idempotencyKey) result.run_id = `CP-${result.checksum}-${idempotencyKey}`;
    const response = envelope.response_mode === 'summary'
      ? { ...result, matches:result.matches.slice(0,100), exceptions:result.exceptions.slice(0,100), truncated:{matches:Math.max(0,result.matches.length-100),exceptions:Math.max(0,result.exceptions.length-100)} }
      : result;
    return json(response,200,{'X-ClosePilot-Run-Id':result.run_id,'X-Engine-Version':result.engine_version});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
    return json({error:'reconciliation_failed',message},500);
  }
}
