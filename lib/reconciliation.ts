import { classifyNarration, evaluateNarrationClassifier } from './narration-classifier.ts';

export type RawRecord = Record<string, unknown>;
export type RecordSource = 'Razorpay payment' | 'Razorpay settlement' | 'Bank statement' | 'Invoice ledger';
export type DecisionStatus = 'Matched' | 'Review' | 'Blocked';

export interface ReconciliationInput {
  payments?: RawRecord[];
  settlements?: RawRecord[];
  bank_transactions?: RawRecord[];
  invoices?: RawRecord[];
  ground_truth?: Array<{ left_id: string; right_id: string }>;
  options?: Partial<ReconciliationOptions>;
}

export interface ReconciliationOptions {
  auto_match_threshold: number;
  review_threshold: number;
  ambiguity_margin: number;
  amount_tolerance: number;
  date_window_days: number;
  max_candidate_bucket: number;
}

export interface DecisionRecord {
  id: string;
  source: string;
  reference: string;
  amount: number;
  status: DecisionStatus;
  confidence: number;
  date: string;
  reason: string;
  action: string;
  evidence: string[];
  domain: 'payment_to_invoice' | 'settlement_to_bank' | 'validation';
  matched_with?: string;
}

export interface ReconciliationMetrics {
  input_records: number;
  normalized_records: number;
  matched_pairs: number;
  matched_records: number;
  review_records: number;
  blocked_records: number;
  exception_records: number;
  match_rate: number;
  value_reconciled: number;
  duration_ms: number;
  throughput_records_per_second: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  false_auto_match_rate: number | null;
  ground_truth_pairs: number;
  silent_drops: number;
  narration_classifier_accuracy: number;
}

export interface ReconciliationResult {
  run_id: string;
  engine_version: string;
  ruleset: string;
  generated_at: string;
  checksum: string;
  metrics: ReconciliationMetrics;
  matches: DecisionRecord[];
  exceptions: DecisionRecord[];
  audit: Array<{ time: string; title: string; copy: string; tone: 'done' | 'warn' | 'ai' | 'neutral' }>;
  source_coverage: Array<{ source: string; total: number; resolved: number; rate: number }>;
}

interface CanonicalRecord {
  id: string;
  source: RecordSource;
  amount: number;
  date: number | null;
  dateLabel: string;
  orderId: string;
  invoiceId: string;
  paymentId: string;
  settlementId: string;
  utr: string;
  email: string;
  customerId: string;
  reference: string;
  narration: string;
  status: string;
  currency: string;
  merchantId: string;
  direction: string;
  originalIndex: number;
}

interface Candidate {
  left: CanonicalRecord;
  right: CanonicalRecord;
  score: number;
  evidence: string[];
  reason: string;
}

interface DomainResult {
  matches: DecisionRecord[];
  exceptions: DecisionRecord[];
  resolvedIds: Set<string>;
}

const ENGINE_VERSION = '2.0.0';
const RULESET = 'closepilot-reconcile-v2';
const DEFAULTS: ReconciliationOptions = {
  auto_match_threshold: 85,
  review_threshold: 55,
  ambiguity_margin: 10,
  amount_tolerance: 1,
  date_window_days: 3,
  max_candidate_bucket: 64,
};

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value: unknown) => value == null ? '' : String(value).trim();
const normalizedHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function indexedRow(row: RawRecord) {
  const result = new Map<string, unknown>();
  for (const [header, value] of Object.entries(row)) result.set(normalizedHeader(header), value);
  return result;
}

function pick(row: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row.get(normalizedHeader(alias));
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return undefined;
}

function parseAmount(value: unknown, isPaise = false) {
  if (value === undefined || value === null || value === '') return Number.NaN;
  const normalized = typeof value === 'number' ? value : String(value).replace(/[^0-9.-]/g, '');
  if (typeof normalized === 'string' && !/[0-9]/.test(normalized)) return Number.NaN;
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.abs(isPaise ? parsed / 100 : parsed);
}

function parseDate(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateLabel(timestamp: number | null) {
  if (timestamp === null) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(timestamp);
}

function normalizeRows(rows: RawRecord[], source: RecordSource) {
  const records: CanonicalRecord[] = [];
  const exceptions: DecisionRecord[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, originalIndex) => {
    const row = indexedRow(raw);
    const idAliases = source === 'Razorpay payment'
      ? ['id','payment_id','paymentid','transaction_id','txnid']
      : source === 'Razorpay settlement'
        ? ['id','settlement_id','settlementid','batch_id']
        : source === 'Bank statement'
          ? ['id','transaction_id','txnid','bank_reference','reference_id','utr']
          : ['id','invoice_id','invoiceid','document_number','invoice_number'];
    const rawId = text(pick(row, idAliases));
    const id = rawId || `invalid_${key(source)}_${originalIndex + 1}`;
    const amountAliases = source === 'Razorpay settlement'
      ? ['net_amount','settlement_amount','amount','amount_paise']
      : source === 'Bank statement'
        ? ['credit','deposit','transaction_amount','amount','amount_paise']
        : source === 'Invoice ledger'
          ? ['grand_total','invoice_amount','total','amount','amount_paise']
          : ['payment_amount','amount','amount_paise'];
    const amountEntry = pick(row, amountAliases);
    const amountIsPaise = row.has('amountpaise') && amountEntry === row.get('amountpaise');
    const amount = parseAmount(amountEntry, amountIsPaise);
    const timestamp = parseDate(pick(row, ['created_at','createdat','date','transaction_date','posted_at','paid_at','issued_at','timestamp']));
    const duplicate = rawId ? seen.has(key(rawId)) : false;
    if (rawId) seen.add(key(rawId));
    if (!rawId || !Number.isFinite(amount) || duplicate) {
      const failures = [!rawId ? 'missing stable record ID' : '', !Number.isFinite(amount) ? 'invalid amount' : '', duplicate ? 'duplicate record ID' : ''].filter(Boolean);
      exceptions.push({
        id,
        source,
        reference: '—',
        amount: Number.isFinite(amount) ? amount : 0,
        status: 'Blocked',
        confidence: 0,
        date: dateLabel(timestamp),
        reason: `Schema validation failed: ${failures.join(', ')}.`,
        action: 'Correct the source record and retry with the same idempotency key.',
        evidence: failures,
        domain: 'validation',
      });
      return;
    }
    records.push({
      id,
      source,
      amount,
      date: timestamp,
      dateLabel: dateLabel(timestamp),
      orderId: text(pick(row, ['order_id','orderid','merchant_order_id'])),
      invoiceId: text(pick(row, ['invoice_id','invoiceid','invoice_number'])),
      paymentId: text(pick(row, ['payment_id','paymentid','razorpay_payment_id'])),
      settlementId: text(pick(row, ['settlement_id','settlementid','batch_id'])),
      utr: text(pick(row, ['utr','bank_utr','settlement_utr','rrn'])),
      email: text(pick(row, ['email','customer_email','buyer_email'])).toLowerCase(),
      customerId: text(pick(row, ['customer_id','customerid','account_id','merchant_customer_id'])),
      reference: text(pick(row, ['reference','reference_id','notes','description','bank_reference','order_reference'])),
      narration: text(pick(row, ['narration','description','remarks','notes','particulars'])),
      status: text(pick(row, ['status','state','invoice_status'])).toLowerCase(),
      currency: text(pick(row, ['currency','currency_code','ccy']) ?? 'INR').toUpperCase(),
      merchantId: text(pick(row, ['merchant_id','merchantid','account_id','business_id'])),
      direction: text(pick(row, ['type','direction','debit_credit','transaction_type'])).toLowerCase(),
      originalIndex,
    });
  });
  return { records, exceptions };
}

const addIndex = (index: Map<string, CanonicalRecord[]>, indexKey: string, record: CanonicalRecord) => {
  if (!indexKey) return;
  const bucket = index.get(indexKey);
  if (bucket) bucket.push(record); else index.set(indexKey, [record]);
};

function amountBucket(amount: number, tolerance: number) {
  return String(Math.round(amount / Math.max(tolerance, 0.01)));
}

function scopeKey(record: CanonicalRecord) {
  return `${key(record.currency || 'INR')}|${key(record.merchantId || '*')}`;
}

function daysBetween(a: number | null, b: number | null) {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

function containsToken(haystack: string, needle: string) {
  const normalizedNeedle = key(needle);
  return normalizedNeedle.length >= 5 && key(haystack).includes(normalizedNeedle);
}

function scorePaymentInvoice(payment: CanonicalRecord, invoice: CanonicalRecord, options: ReconciliationOptions): Candidate {
  let score = 0;
  const evidence: string[] = [];
  if (payment.currency && invoice.currency && payment.currency !== invoice.currency) return { left:payment,right:invoice,score:0,evidence:['Currency mismatch'],reason:'Currency mismatch' };
  if (payment.merchantId && invoice.merchantId && key(payment.merchantId) !== key(invoice.merchantId)) return { left:payment,right:invoice,score:0,evidence:['Merchant scope mismatch'],reason:'Merchant scope mismatch' };
  const direct = key(payment.invoiceId) === key(invoice.id) || key(invoice.paymentId) === key(payment.id);
  if (direct) { score += 70; evidence.push('Direct payment ↔ invoice identifier'); }
  if (payment.orderId && invoice.orderId && key(payment.orderId) === key(invoice.orderId)) { score += 42; evidence.push('Order ID exact'); }
  if (containsToken(payment.reference, invoice.id) || containsToken(invoice.reference, payment.id)) { score += 40; evidence.push('Cross-reference exact'); }
  const variance = Math.abs(payment.amount - invoice.amount);
  if (variance <= options.amount_tolerance) { score += 25; evidence.push('Amount exact within tolerance'); }
  else if (variance / Math.max(payment.amount, invoice.amount, 1) <= 0.005) { score += 12; evidence.push('Amount within 0.5%'); }
  if (payment.email && invoice.email && payment.email === invoice.email) { score += 12; evidence.push('Customer email exact'); }
  if (payment.customerId && invoice.customerId && key(payment.customerId) === key(invoice.customerId)) { score += 12; evidence.push('Customer ID exact'); }
  const dayGap = daysBetween(payment.date, invoice.date);
  if (dayGap <= 1) { score += 10; evidence.push('Date within 24 hours'); }
  else if (dayGap <= options.date_window_days) { score += 5; evidence.push(`Date within ${options.date_window_days} days`); }
  if (['void','voided','cancelled','canceled'].includes(invoice.status)) { score -= 80; evidence.push('Invoice is void or cancelled'); }
  return { left: payment, right: invoice, score: Math.max(0, Math.min(99, score)), evidence, reason: evidence.join(' · ') };
}

function scoreSettlementBank(settlement: CanonicalRecord, bank: CanonicalRecord, options: ReconciliationOptions): Candidate {
  let score = 0;
  const evidence: string[] = [];
  if (settlement.currency && bank.currency && settlement.currency !== bank.currency) return { left:settlement,right:bank,score:0,evidence:['Currency mismatch'],reason:'Currency mismatch' };
  if (settlement.merchantId && bank.merchantId && key(settlement.merchantId) !== key(bank.merchantId)) return { left:settlement,right:bank,score:0,evidence:['Merchant scope mismatch'],reason:'Merchant scope mismatch' };
  if (['debit','dr','outflow'].includes(bank.direction)) return { left:settlement,right:bank,score:0,evidence:['Bank transaction is not a credit'],reason:'Bank transaction is not a credit' };
  if (settlement.utr && bank.utr && key(settlement.utr) === key(bank.utr)) { score += 70; evidence.push('UTR exact'); }
  if (containsToken(bank.reference, settlement.id) || containsToken(bank.narration, settlement.id) || containsToken(settlement.reference, bank.id)) { score += 55; evidence.push('Settlement reference found in bank feed'); }
  const variance = Math.abs(settlement.amount - bank.amount);
  if (variance <= options.amount_tolerance) { score += 25; evidence.push('Net amount exact within tolerance'); }
  else if (variance / Math.max(settlement.amount, bank.amount, 1) <= 0.0025) { score += 12; evidence.push('Net amount within 0.25%'); }
  const dayGap = daysBetween(settlement.date, bank.date);
  if (dayGap <= 1) { score += 10; evidence.push('Credit inside settlement window'); }
  else if (dayGap <= options.date_window_days) { score += 5; evidence.push(`Credit within ${options.date_window_days} days`); }
  const classification = classifyNarration(bank.narration || bank.reference);
  if (classification.label === 'settlement' && classification.confidence >= 0.45) {
    score += 3;
    evidence.push(`Narration model: settlement (${Math.round(classification.confidence * 100)}%)`);
  }
  return { left: settlement, right: bank, score: Math.max(0, Math.min(99, score)), evidence, reason: evidence.join(' · ') };
}

function buildCandidateGenerator(rights: CanonicalRecord[], options: ReconciliationOptions, domain: 'payment_to_invoice' | 'settlement_to_bank') {
  const byId = new Map<string, CanonicalRecord[]>();
  const byOrder = new Map<string, CanonicalRecord[]>();
  const byPayment = new Map<string, CanonicalRecord[]>();
  const byUtr = new Map<string, CanonicalRecord[]>();
  const byAmount = new Map<string, CanonicalRecord[]>();
  const byEmail = new Map<string, CanonicalRecord[]>();
  const byCustomer = new Map<string, CanonicalRecord[]>();
  rights.forEach((record) => {
    addIndex(byId, key(record.id), record);
    if (record.orderId) addIndex(byOrder, `${scopeKey(record)}|${key(record.orderId)}`, record);
    addIndex(byPayment, key(record.paymentId), record);
    addIndex(byUtr, key(record.utr), record);
    addIndex(byAmount, `${scopeKey(record)}|${amountBucket(record.amount, options.amount_tolerance)}`, record);
    if (record.email) addIndex(byEmail, `${scopeKey(record)}|${key(record.email)}`, record);
    if (record.customerId) addIndex(byCustomer, `${scopeKey(record)}|${key(record.customerId)}`, record);
  });
  const addBucket = (target: Set<CanonicalRecord>, bucket?: CanonicalRecord[], allowLarge = false) => {
    if (!bucket || (!allowLarge && bucket.length > options.max_candidate_bucket)) return;
    bucket.forEach((record) => target.add(record));
  };
  return (left: CanonicalRecord) => {
    const candidates = new Set<CanonicalRecord>();
    if (domain === 'payment_to_invoice') {
      addBucket(candidates, byId.get(key(left.invoiceId)), true);
      addBucket(candidates, byPayment.get(key(left.id)), true);
      if (left.orderId) addBucket(candidates, byOrder.get(`${scopeKey(left)}|${key(left.orderId)}`));
      if (left.email) addBucket(candidates, byEmail.get(`${scopeKey(left)}|${key(left.email)}`));
      if (left.customerId) addBucket(candidates, byCustomer.get(`${scopeKey(left)}|${key(left.customerId)}`));
    } else {
      addBucket(candidates, byUtr.get(key(left.utr)), true);
      addBucket(candidates, byId.get(key(left.reference)), true);
    }
    addBucket(candidates, byAmount.get(`${scopeKey(left)}|${amountBucket(left.amount, options.amount_tolerance)}`));
    return [...candidates];
  };
}

function toMatch(candidate: Candidate, domain: DecisionRecord['domain']): DecisionRecord {
  return {
    id: candidate.left.id,
    source: `${candidate.left.source} ↔ ${candidate.right.source}`,
    reference: candidate.right.id,
    amount: candidate.left.amount,
    status: 'Matched',
    confidence: candidate.score,
    date: candidate.left.dateLabel,
    reason: candidate.reason,
    action: 'Verified automatically; downstream posting remains idempotency-gated.',
    evidence: candidate.evidence,
    domain,
    matched_with: candidate.right.id,
  };
}

function toException(record: CanonicalRecord, domain: DecisionRecord['domain'], status: 'Review' | 'Blocked', candidate?: Candidate): DecisionRecord {
  const reason = candidate
    ? candidate.score >= DEFAULTS.review_threshold
      ? `Candidate ${candidate.right.id} is plausible but not safe to auto-match.`
      : 'No candidate passed the review threshold.'
    : 'No supported identifier, amount, or date combination produced a safe candidate.';
  return {
    id: record.id,
    source: record.source,
    reference: candidate?.right.id ?? '—',
    amount: record.amount,
    status,
    confidence: candidate?.score ?? 0,
    date: record.dateLabel,
    reason,
    action: status === 'Review' ? 'Present the evidence to a finance operator; do not post automatically.' : 'Keep unresolved and request corrected source evidence.',
    evidence: candidate?.evidence.length ? candidate.evidence : ['No safe deterministic match'],
    domain,
  };
}

function reconcileDomain(
  lefts: CanonicalRecord[],
  rights: CanonicalRecord[],
  domain: 'payment_to_invoice' | 'settlement_to_bank',
  options: ReconciliationOptions,
): DomainResult {
  const candidateGenerator = buildCandidateGenerator(rights, options, domain);
  const scorer = domain === 'payment_to_invoice' ? scorePaymentInvoice : scoreSettlementBank;
  const ranked = lefts.map((left) => ({
    left,
    candidates: candidateGenerator(left).map((right) => scorer(left, right, options)).filter((candidate) => candidate.score > 0).sort((a,b) => b.score - a.score),
  })).sort((a,b) => (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0));
  const usedRight = new Set<string>();
  const resolvedIds = new Set<string>();
  const matches: DecisionRecord[] = [];
  const exceptions: DecisionRecord[] = [];
  for (const item of ranked) {
    const available = item.candidates.filter((candidate) => !usedRight.has(`${candidate.right.source}:${candidate.right.id}`));
    const top = available[0];
    const runnerUp = available[1];
    const margin = top ? top.score - (runnerUp?.score ?? 0) : 0;
    if (top && top.score >= options.auto_match_threshold && margin >= options.ambiguity_margin) {
      usedRight.add(`${top.right.source}:${top.right.id}`);
      resolvedIds.add(`${top.left.source}:${top.left.id}`);
      resolvedIds.add(`${top.right.source}:${top.right.id}`);
      matches.push(toMatch(top, domain));
    } else if (top && top.score >= options.review_threshold) {
      const ambiguityEvidence = runnerUp && margin < options.ambiguity_margin ? [`Ambiguous: top two candidates are ${margin} points apart`] : [];
      top.evidence.push(...ambiguityEvidence);
      exceptions.push(toException(item.left, domain, 'Review', top));
    } else {
      exceptions.push(toException(item.left, domain, 'Blocked', top));
    }
  }
  for (const right of rights) {
    if (!resolvedIds.has(`${right.source}:${right.id}`)) exceptions.push(toException(right, domain, 'Blocked'));
  }
  return { matches, exceptions, resolvedIds };
}

function pairKey(left: string, right: string) {
  return [key(left), key(right)].sort().join('::');
}

function evaluate(matches: DecisionRecord[], groundTruth: ReconciliationInput['ground_truth']) {
  if (!groundTruth) return { precision:null, recall:null, f1:null, falseRate:null, truthCount:0 };
  const expected = new Set(groundTruth.map((pair) => pairKey(pair.left_id, pair.right_id)));
  const predicted = new Set(matches.filter((match) => match.matched_with).map((match) => pairKey(match.id, match.matched_with!)));
  let truePositives = 0;
  predicted.forEach((prediction) => { if (expected.has(prediction)) truePositives += 1; });
  const falsePositives = predicted.size - truePositives;
  const falseNegatives = expected.size - truePositives;
  const precision = predicted.size ? truePositives / predicted.size : expected.size ? 0 : 1;
  const recall = expected.size ? truePositives / expected.size : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return { precision, recall, f1, falseRate: predicted.size ? falsePositives / predicted.size : 0, truthCount: expected.size, falsePositives, falseNegatives };
}

function checksum(records: CanonicalRecord[]) {
  let hash = 2166136261;
  for (const record of records) {
    const value = `${record.source}|${record.id}|${record.amount}|${record.date ?? ''}`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function coverageFor(source: RecordSource, records: CanonicalRecord[], resolvedIds: Set<string>) {
  const sourceRecords = records.filter((record) => record.source === source);
  const resolved = sourceRecords.filter((record) => resolvedIds.has(`${record.source}:${record.id}`)).length;
  return { source, total: sourceRecords.length, resolved, rate: sourceRecords.length ? resolved / sourceRecords.length : 0 };
}

export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const started = performance.now();
  const options: ReconciliationOptions = { ...DEFAULTS, ...input.options };
  const paymentResult = normalizeRows(input.payments ?? [], 'Razorpay payment');
  const settlementResult = normalizeRows(input.settlements ?? [], 'Razorpay settlement');
  const bankResult = normalizeRows(input.bank_transactions ?? [], 'Bank statement');
  const invoiceResult = normalizeRows(input.invoices ?? [], 'Invoice ledger');
  const allRecords = [...paymentResult.records, ...settlementResult.records, ...bankResult.records, ...invoiceResult.records];
  const validationExceptions = [...paymentResult.exceptions, ...settlementResult.exceptions, ...bankResult.exceptions, ...invoiceResult.exceptions];
  const paymentDomain = reconcileDomain(paymentResult.records, invoiceResult.records, 'payment_to_invoice', options);
  const settlementDomain = reconcileDomain(settlementResult.records, bankResult.records, 'settlement_to_bank', options);
  const matches = [...paymentDomain.matches, ...settlementDomain.matches];
  const exceptions = [...validationExceptions, ...paymentDomain.exceptions, ...settlementDomain.exceptions];
  const resolvedIds = new Set([...paymentDomain.resolvedIds, ...settlementDomain.resolvedIds]);
  const evaluation = evaluate(matches, input.ground_truth);
  const classifierEvaluation = evaluateNarrationClassifier();
  const inputRecords = (input.payments?.length ?? 0) + (input.settlements?.length ?? 0) + (input.bank_transactions?.length ?? 0) + (input.invoices?.length ?? 0);
  const duration = Math.max(performance.now() - started, 0.01);
  const matchedRecords = matches.length * 2;
  const reviewRecords = exceptions.filter((record) => record.status === 'Review').length;
  const blockedRecords = exceptions.filter((record) => record.status === 'Blocked').length;
  const generatedAt = new Date().toISOString();
  const batchChecksum = checksum(allRecords);
  const metrics: ReconciliationMetrics = {
    input_records: inputRecords,
    normalized_records: allRecords.length,
    matched_pairs: matches.length,
    matched_records: matchedRecords,
    review_records: reviewRecords,
    blocked_records: blockedRecords,
    exception_records: exceptions.length,
    match_rate: allRecords.length ? matchedRecords / allRecords.length : 0,
    value_reconciled: matches.reduce((sum, record) => sum + record.amount, 0),
    duration_ms: duration,
    throughput_records_per_second: inputRecords / (duration / 1000),
    precision: evaluation.precision,
    recall: evaluation.recall,
    f1: evaluation.f1,
    false_auto_match_rate: evaluation.falseRate,
    ground_truth_pairs: evaluation.truthCount,
    silent_drops: inputRecords - allRecords.length - validationExceptions.length,
    narration_classifier_accuracy: classifierEvaluation.accuracy,
  };
  const now = new Date(generatedAt).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Kolkata'});
  return {
    run_id: `CP-${batchChecksum}-${Date.now().toString(36)}`,
    engine_version: ENGINE_VERSION,
    ruleset: RULESET,
    generated_at: generatedAt,
    checksum: batchChecksum,
    metrics,
    matches,
    exceptions,
    audit: [
      { time:now, title:'Run completed', copy:`${inputRecords.toLocaleString('en-IN')} records processed in ${duration.toFixed(2)} ms; ${matches.length} pairs verified.`, tone:'done' },
      { time:now, title:'Safety gates applied', copy:`${reviewRecords} records require review and ${blockedRecords} remain blocked. No low-confidence write was executed.`, tone:exceptions.length ? 'warn' : 'done' },
      { time:now, title:'Narration model evaluated', copy:`Local classifier scored ${(classifierEvaluation.accuracy * 100).toFixed(1)}% on its isolated holdout set.`, tone:'ai' },
      { time:now, title:'Cross-source indexes built', copy:'Candidate generation used identifier and bounded amount indexes; no Cartesian product scan was performed.', tone:'done' },
      { time:now, title:'Batch accepted', copy:`Ruleset ${RULESET}; checksum ${batchChecksum}; zero silent drops.`, tone:'neutral' },
    ],
    source_coverage: [
      coverageFor('Razorpay payment', allRecords, resolvedIds),
      coverageFor('Razorpay settlement', allRecords, resolvedIds),
      coverageFor('Bank statement', allRecords, resolvedIds),
      coverageFor('Invoice ledger', allRecords, resolvedIds),
    ],
  };
}

export const reconciliationDefaults = DEFAULTS;
