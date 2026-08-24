import { createBenchmarkDataset } from '@/lib/benchmark.ts';
import { ReconciliationInputError, reconcile, type ReconciliationInput } from '@/lib/reconciliation.ts';
import { PUBLIC_ORIGIN } from '@/lib/public-origin.ts';
import { sha256 } from '@/lib/sha256.ts';

export const runtime = 'edge';

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const FULL_RESPONSE_LIMIT = 20_000;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-API-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-ClosePilot-Run-Id, X-Engine-Version, X-Verification-Receipt',
};

const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    ...cors,
    ...headers,
  },
});

const arrays = (input: ReconciliationInput) => [input.payments, input.settlements, input.bank_transactions, input.invoices, input.settlement_recon_items];

function configuredApiKey() {
  return typeof process !== 'undefined' ? process.env.CLOSEPILOT_API_KEY : undefined;
}

function validApiKey(request:Request) {
  const expected = configuredApiKey();
  if (!expected) return true;
  const supplied = request.headers.get('x-api-key') ?? '';
  const expectedHash = sha256(expected);
  const suppliedHash = sha256(supplied);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) difference |= suppliedHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

export function OPTIONS() {
  return new Response(null, { status:204, headers:cors });
}

export function GET(request: Request) {
  void request;
  const endpoint = `${PUBLIC_ORIGIN}/api/v1/reconcile`;
  return json({
    name:'ClosePilot Reconciliation API',
    version:'3.0.0',
    endpoint,
    method:'POST',
    description:'Exact-money reconciliation for Razorpay payments, invoices, settlement items, settlements and bank transactions. Every automatic decision is independently verified and receipt-hashed.',
    request:{
      payments:'Array<Record<string, unknown>>',
      invoices:'Array<Record<string, unknown>>',
      settlements:'Array<Record<string, unknown>>',
      bank_transactions:'Array<Record<string, unknown>>',
      settlement_recon_items:'Optional Razorpay Fetch Settlement Recon rows. credit/debit/fee/tax must be currency subunits.',
      ground_truth:'Optional Array<{left_id,right_id}> for measured precision/recall',
      response_mode:'Optional "full" (default) or "summary"',
    },
    headers:{
      'Idempotency-Key':'Optional 1-128 character stable key. Reusing it with the same payload returns a stable run identifier.',
      'X-API-Key':'Required only when the deployment owner configures CLOSEPILOT_API_KEY.',
    },
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
  if (!validApiKey(request)) return json({error:'unauthorized',message:'A valid X-API-Key is required for this deployment.'},401,{'WWW-Authenticate':'ApiKey'});
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) return json({error:'unsupported_media_type',message:'Content-Type must be application/json.'},415);
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({error:'payload_too_large',message:`Request body exceeds ${MAX_BODY_BYTES} bytes.`},413);
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';
  if (idempotencyKey && (idempotencyKey.length > 128 || !/^[\x21-\x7E]+$/.test(idempotencyKey))) return json({error:'invalid_idempotency_key',message:'Idempotency-Key must contain 1-128 visible ASCII characters.'},400);
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({error:'payload_too_large',message:`Request body exceeds ${MAX_BODY_BYTES} bytes.`},413);
    body = JSON.parse(rawBody);
  }
  catch { return json({error:'invalid_json',message:'Body must be valid JSON.'},400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid_payload',message:'Body must be a JSON object.'},400);
  const envelope = body as ReconciliationInput & { benchmark?: boolean; benchmark_scale?: number; response_mode?: 'full'|'summary' };
  if (envelope.benchmark !== undefined && typeof envelope.benchmark !== 'boolean') return json({error:'invalid_benchmark',message:'benchmark must be a boolean.'},400);
  if (envelope.benchmark_scale !== undefined && (!Number.isInteger(envelope.benchmark_scale) || envelope.benchmark_scale < 1 || envelope.benchmark_scale > 10)) return json({error:'invalid_benchmark_scale',message:'benchmark_scale must be an integer between 1 and 10.'},400);
  const input: ReconciliationInput = envelope.benchmark
    ? createBenchmarkDataset(Math.min(10, Math.max(1, Number(envelope.benchmark_scale ?? 1))))
    : envelope;
  if (arrays(input).some((value) => value !== undefined && !Array.isArray(value))) return json({error:'invalid_dataset',message:'Every supplied dataset must be an array of records.'},400);
  if (input.ground_truth !== undefined && !Array.isArray(input.ground_truth)) return json({error:'invalid_ground_truth',message:'ground_truth must be an array.'},400);
  if (input.ground_truth?.some((pair) => !pair || typeof pair !== 'object' || typeof pair.left_id !== 'string' || typeof pair.right_id !== 'string')) return json({error:'invalid_ground_truth',message:'Every ground_truth entry must contain string left_id and right_id values.'},400);
  if ((input.ground_truth?.length ?? 0) > MAX_RECORDS) return json({error:'ground_truth_limit_exceeded',message:`ground_truth accepts at most ${MAX_RECORDS.toLocaleString('en-IN')} pairs.`},413);
  if (input.options !== undefined && (!input.options || typeof input.options !== 'object' || Array.isArray(input.options))) return json({error:'invalid_options',message:'options must be a JSON object.'},400);
  if (envelope.response_mode !== undefined && !['full','summary'].includes(envelope.response_mode)) return json({error:'invalid_response_mode',message:'response_mode must be full or summary.'},400);
  const total = arrays(input).reduce((sum, value) => sum + (value?.length ?? 0), 0);
  const coreTotal = [input.payments,input.settlements,input.bank_transactions,input.invoices].reduce((sum, value) => sum + (value?.length ?? 0), 0);
  if (!coreTotal) return json({error:'empty_dataset',message:'Supply payments + invoices, settlements + bank_transactions, or {"benchmark":true}.'},400);
  if (total > MAX_RECORDS) return json({error:'record_limit_exceeded',message:`This endpoint accepts at most ${MAX_RECORDS.toLocaleString('en-IN')} records per batch. Shard larger jobs by merchant, currency and settlement date.`},413);
  if (envelope.response_mode !== 'summary' && total > FULL_RESPONSE_LIMIT) return json({error:'full_response_limit_exceeded',message:`Use response_mode:"summary" above ${FULL_RESPONSE_LIMIT.toLocaleString('en-IN')} records, or shard the batch.`},413);
  const rawArrays = arrays(input).flatMap((value) => value ?? []);
  if (rawArrays.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) return json({error:'invalid_record',message:'Every dataset entry must be a JSON object.'},400);

  try {
    const result = reconcile(input);
    if (idempotencyKey) result.run_id = `CP-${result.checksum}-${sha256(idempotencyKey).slice(0,12)}`;
    const response = envelope.response_mode === 'summary'
      ? { ...result, matches:result.matches.slice(0,100), exceptions:result.exceptions.slice(0,100), settlement_closures:result.settlement_closures.slice(0,100), truncated:{matches:Math.max(0,result.matches.length-100),exceptions:Math.max(0,result.exceptions.length-100),settlement_closures:Math.max(0,result.settlement_closures.length-100)} }
      : result;
    return json(response,200,{'X-ClosePilot-Run-Id':result.run_id,'X-Engine-Version':result.engine_version,'X-Verification-Receipt':result.verification.receipt_sha256});
  } catch (error) {
    if (error instanceof ReconciliationInputError) return json({error:'invalid_reconciliation_options',message:error.message},422);
    const verifierFailure = error instanceof Error && error.message.startsWith('Independent verification failed:');
    return json({
      error:verifierFailure ? 'verification_failed' : 'internal_error',
      message:verifierFailure ? error.message : 'The batch could not be processed safely. No result was released.',
    },500);
  }
}
