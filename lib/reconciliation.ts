import { classifyNarration, evaluateNarrationClassifier } from './narration-classifier.ts';
import { currencyExponent, minorToDecimal, minorToNumber, parseMoney, toleranceToMinor } from './money.ts';
import { sha256 } from './sha256.ts';

export type RawRecord = Record<string, unknown>;
export type RecordSource = 'Razorpay payment' | 'Razorpay settlement' | 'Bank statement' | 'Invoice ledger';
export type DecisionStatus = 'Matched' | 'Review' | 'Blocked';

export class ReconciliationInputError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ReconciliationInputError';
  }
}

export interface ReconciliationInput {
  payments?: RawRecord[];
  settlements?: RawRecord[];
  bank_transactions?: RawRecord[];
  invoices?: RawRecord[];
  settlement_recon_items?: RawRecord[];
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
  amount_minor: string;
  currency: string;
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
  processed_records: number;
  normalized_records: number;
  settlement_recon_items: number;
  matched_pairs: number;
  matched_records: number;
  review_records: number;
  blocked_records: number;
  exception_records: number;
  /** Resolved endpoints divided by every submitted primary record, including validation rejects. */
  input_resolution_rate: number;
  /** Resolved endpoints divided by records that normalized successfully. */
  match_rate: number;
  value_reconciled: number | null;
  value_reconciled_minor: string;
  value_reconciled_decimal: string;
  value_reconciled_by_currency: Array<{ currency:string; minor:string; decimal:string }>;
  duration_ms: number | null;
  duration_scope: 'engine_including_verification';
  throughput_records_per_second: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  false_auto_match_rate: number | null;
  ground_truth_pairs: number;
  silent_drops: number;
  narration_classifier_accuracy: number;
  narration_classifier_holdout_size: number;
}

export interface VerificationResult {
  status: 'PASS' | 'FAIL';
  verifier_version: string;
  receipt_sha256: string;
  checked_matches: number;
  invariants: Array<{ code:string; passed:boolean; detail:string }>;
  failures: string[];
}

export interface SettlementClosure {
  settlement_id: string;
  status: 'Verified' | 'Review' | 'Blocked';
  currency: string;
  item_count: number;
  credit_minor: string;
  debit_minor: string;
  net_minor: string;
  expected_minor: string;
  delta_minor: string;
  fee_minor: string;
  tax_minor: string;
  evidence: string[];
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
  settlement_closures: SettlementClosure[];
  verification: VerificationResult;
  agent_execution: {
    model: 'bounded_autonomous_state_machine';
    mode: 'read_only';
    status: 'COMPLETED';
    release_policy: 'verify_before_release';
    stages: Array<{ stage:string; status:'PASS'; records_in:number; records_out:number; detail:string }>;
  };
}

interface CanonicalRecord {
  id: string;
  source: RecordSource;
  amount: number;
  amountMinor: bigint;
  amountExponent: number;
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
  autoEligible: boolean;
}

interface DomainResult {
  matches: DecisionRecord[];
  exceptions: DecisionRecord[];
  resolvedIds: Set<string>;
}

export const ENGINE_VERSION = '3.1.0';
export const RULESET = 'closepilot-reconcile-v3.1';
export const VERIFIER_VERSION = 'closepilot-verifier-v2';
const DEFAULTS: ReconciliationOptions = {
  auto_match_threshold: 85,
  review_threshold: 55,
  ambiguity_margin: 10,
  amount_tolerance: 0,
  date_window_days: 3,
  max_candidate_bucket: 64,
};

// Identifiers are opaque. Stripping punctuation can merge distinct references.
const key = (value: string) => value.trim().toLowerCase();
const text = (value: unknown) => value == null ? '' : String(value).trim();
const normalizedHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedDirection = (value:unknown) => {
  const direction = text(value).toLowerCase();
  if (['d','debit','dr','outflow','withdrawal'].includes(direction)) return 'debit';
  if (['c','credit','cr','inflow','deposit'].includes(direction)) return 'credit';
  return direction;
};

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

function parseDate(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? milliseconds : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateLabel(timestamp: number | null) {
  if (timestamp === null) return 'Date unavailable';
  return recordDateFormatter.format(timestamp);
}

const recordDateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const completedPaymentStates = new Set(['captured','paid','settled','success','successful','succeeded','completed']);
const completedSettlementStates = new Set(['processed','settled','success','successful','succeeded','completed']);

function normalizeRows(rows: RawRecord[], source: RecordSource) {
  const records: CanonicalRecord[] = [];
  const exceptions: DecisionRecord[] = [];
  const idAliases = source === 'Razorpay payment'
    ? ['id','payment_id','paymentid','razorpay_payment_id','transaction_id','txnid','txn_id']
    : source === 'Razorpay settlement'
      ? ['id','settlement_id','settlementid','razorpay_settlement_id','batch_id']
      : source === 'Bank statement'
        ? ['id','transaction_id','bank_transaction_id','txnid','txn_id','bank_reference','reference_id','reference_number','reference_no','utr','utr_number']
        : ['id','invoice_id','invoiceid','document_number','document_no','invoice_number'];
  const idCounts = new Map<string,number>();
  for (const raw of rows) {
    const rawId = text(pick(indexedRow(raw), idAliases));
    if (rawId) idCounts.set(key(rawId), (idCounts.get(key(rawId)) ?? 0) + 1);
  }
  rows.forEach((raw, originalIndex) => {
    const row = indexedRow(raw);
    const rawId = text(pick(row, idAliases));
    const duplicate = rawId ? (idCounts.get(key(rawId)) ?? 0) > 1 : false;
    const id = duplicate ? `${rawId}#duplicate_${originalIndex + 1}` : rawId || `invalid_${key(source)}_${originalIndex + 1}`;
    const currency = text(pick(row, ['currency','currency_code','ccy']) ?? 'INR').toUpperCase();
    const currencyFailure = /^[A-Z]{3}$/.test(currency) ? '' : 'currency must be a three-letter ISO-style code';
    const amountAliases = source === 'Razorpay settlement'
      ? ['net_amount','net_settlement_amount','settlement_amount','settled_amount','amount','amount_minor','amount_subunits','amount_paise']
      : source === 'Bank statement'
        ? ['credit','credit_amount','deposit','deposit_amount','debit','debit_amount','withdrawal','transaction_amount','amount','amount_minor','amount_subunits','amount_paise']
        : source === 'Invoice ledger'
          ? ['grand_total','invoice_amount','amount_due','gross_amount','total','amount','amount_minor','amount_subunits','amount_paise']
          : ['payment_amount','captured_amount','gross_amount','amount','amount_minor','amount_subunits','amount_paise'];
    let amountEntry = pick(row, amountAliases);
    let inferredBankDirection = '';
    let bankColumnFailure = '';
    if (source === 'Bank statement') {
      const explicitDirection = normalizedDirection(pick(row, ['type','direction','debit_credit','credit_debit_indicator','dr_cr','transaction_type']));
      const creditEntry = pick(row, ['credit','credit_amount','deposit','deposit_amount']);
      const debitEntry = pick(row, ['debit','debit_amount','withdrawal']);
      const nonZero = (value:unknown) => {
        try { return value !== undefined && parseMoney(value, currency).minor !== 0n; }
        catch { return false; }
      };
      if (nonZero(creditEntry) && nonZero(debitEntry)) bankColumnFailure = 'bank row has both non-zero credit and debit';
      if (explicitDirection === 'debit' && debitEntry !== undefined) { amountEntry = debitEntry; inferredBankDirection = 'debit'; }
      else if (nonZero(creditEntry)) { amountEntry = creditEntry; inferredBankDirection = 'credit'; }
      else if (debitEntry !== undefined) { amountEntry = debitEntry; inferredBankDirection = 'debit'; }
    }
    const declaredUnit = text(pick(row, ['amount_unit','amountunit','unit'])).toLowerCase();
    const implicitMinorField = ['amountminor','amountsubunits','amountpaise'].some((name) => row.has(name) && amountEntry === row.get(name));
    let unitFailure = declaredUnit && !['major','minor','subunit','subunits','paise'].includes(declaredUnit)
      ? 'amount_unit must be major, minor, subunit or paise'
      : '';
    if (declaredUnit === 'major' && implicitMinorField) unitFailure = 'amount_unit major conflicts with the selected minor-unit amount field';
    const entity = text(pick(row, ['entity'])).toLowerCase();
    const officialRazorpayEntity = (source === 'Razorpay payment' && entity === 'payment')
      || (source === 'Razorpay settlement' && entity === 'settlement')
      || (source === 'Invoice ledger' && entity === 'invoice');
    const isMinorEntry = implicitMinorField
      || ['minor','subunit','subunits','paise'].includes(declaredUnit)
      || (!declaredUnit && officialRazorpayEntity);
    let parsedAmount: ReturnType<typeof parseMoney> | null = null;
    let amountFailure = '';
    try {
      parsedAmount = parseMoney(amountEntry, currency, isMinorEntry);
      if (parsedAmount.minor === 0n) amountFailure = 'amount must be greater than zero';
      if (source !== 'Bank statement' && parsedAmount.minor < 0n) amountFailure = 'negative amounts require a separate refund or credit-note workflow';
    } catch (error) {
      amountFailure = error instanceof Error ? error.message : 'invalid amount';
    }
    const signedMinor = parsedAmount?.minor ?? 0n;
    // Preserve the source sign. Direction labels must never turn an outflow into an inflow.
    const amountMinor = signedMinor;
    const amountExponent = parsedAmount?.exponent ?? currencyExponent(currency);
    const amount = minorToNumber(amountMinor, amountExponent);
    const timestamp = parseDate(pick(row, ['created_at','createdat','date','transaction_date','transaction_datetime','value_date','posted_at','paid_at','issued_at','settled_at','timestamp']));
    if (!rawId || !parsedAmount || amountFailure || currencyFailure || unitFailure || bankColumnFailure || duplicate) {
      const failures = [!rawId ? 'missing stable record ID' : '', amountFailure ? `invalid amount: ${amountFailure}` : '', currencyFailure, unitFailure, bankColumnFailure, duplicate ? 'duplicate record ID' : ''].filter(Boolean);
      exceptions.push({
        id,
        source,
        reference: '—',
        amount: parsedAmount ? amount : 0,
        amount_minor: parsedAmount ? amountMinor.toString() : '0',
        currency,
        status: 'Blocked',
        confidence: 0,
        date: dateLabel(timestamp),
        reason: `Schema validation failed: ${failures.join(', ')}.`,
        action: 'Correct the source record and rerun reconciliation; this API does not post to source systems.',
        evidence: failures,
        domain: 'validation',
      });
      return;
    }
    records.push({
      id,
      source,
      amount,
      amountMinor,
      amountExponent,
      date: timestamp,
      dateLabel: dateLabel(timestamp),
      orderId: text(pick(row, ['order_id','orderid','razorpay_order_id','merchant_order_id'])),
      invoiceId: text(pick(row, ['invoice_id','invoiceid','invoice_number','invoice_reference'])),
      paymentId: text(pick(row, ['payment_id','paymentid','razorpay_payment_id','payment_reference'])),
      settlementId: text(pick(row, ['settlement_id','settlementid','razorpay_settlement_id','batch_id'])),
      utr: text(pick(row, ['utr','utr_number','bank_utr','settlement_utr','bank_reference_number','reference_number','rrn'])),
      email: text(pick(row, ['email','customer_email','buyer_email'])).toLowerCase(),
      customerId: text(pick(row, ['customer_id','customerid','account_id','merchant_customer_id'])),
      reference: text(pick(row, ['reference','reference_id','reference_no','transaction_reference','notes','description','bank_reference','order_reference'])),
      narration: text(pick(row, ['narration','description','remarks','notes','particulars'])),
      status: text(pick(row, ['status','state','invoice_status'])).toLowerCase(),
      currency,
      merchantId: text(pick(row, ['merchant_id','merchantid','merchant_account_id','account_id','business_id'])),
      direction: normalizedDirection(pick(row, ['type','direction','debit_credit','credit_debit_indicator','dr_cr','transaction_type']))
        || inferredBankDirection
        || (signedMinor < 0n ? 'debit' : ''),
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

const absMinor = (value: bigint) => value < 0n ? -value : value;

function amountBucket(amountMinor: bigint, toleranceMinor: bigint) {
  return amountMinor / (toleranceMinor > 0n ? toleranceMinor : 1n);
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
  if (normalizedNeedle.length < 5) return false;
  const normalizedHaystack = key(haystack);
  let from = 0;
  while (from < normalizedHaystack.length) {
    const index = normalizedHaystack.indexOf(normalizedNeedle, from);
    if (index < 0) return false;
    const before = normalizedHaystack[index - 1] ?? '';
    const after = normalizedHaystack[index + normalizedNeedle.length] ?? '';
    if (!/[a-z0-9_-]/.test(before) && !/[a-z0-9_-]/.test(after)) return true;
    from = index + 1;
  }
  return false;
}

function scorePaymentInvoice(payment: CanonicalRecord, invoice: CanonicalRecord, options: ReconciliationOptions): Candidate {
  let score = 0;
  const evidence: string[] = [];
  if (payment.currency && invoice.currency && payment.currency !== invoice.currency) return { left:payment,right:invoice,score:0,evidence:['Currency mismatch'],reason:'Currency mismatch',autoEligible:false };
  if (payment.merchantId && invoice.merchantId && key(payment.merchantId) !== key(invoice.merchantId)) return { left:payment,right:invoice,score:0,evidence:['Merchant scope mismatch'],reason:'Merchant scope mismatch',autoEligible:false };
  if ((payment.invoiceId && key(payment.invoiceId) !== key(invoice.id)) || (invoice.paymentId && key(invoice.paymentId) !== key(payment.id))) return {left:payment,right:invoice,score:0,evidence:['Conflicting direct identifiers'],reason:'Conflicting direct identifiers',autoEligible:false};
  const direct = key(payment.invoiceId) === key(invoice.id) || key(invoice.paymentId) === key(payment.id);
  if (direct) { score += 70; evidence.push('Direct payment ↔ invoice identifier'); }
  if (payment.orderId && invoice.orderId && key(payment.orderId) === key(invoice.orderId)) { score += 42; evidence.push('Order ID exact'); }
  if (containsToken(payment.reference, invoice.id) || containsToken(invoice.reference, payment.id)) { score += 40; evidence.push('Cross-reference exact'); }
  const variance = absMinor(payment.amountMinor - invoice.amountMinor);
  const tolerance = toleranceToMinor(options.amount_tolerance, payment.amountExponent);
  const amountSafe = variance === 0n;
  if (amountSafe) { score += 25; evidence.push('Amount exact to the minor unit'); }
  else if (variance <= tolerance) { score += 15; evidence.push('Amount inside configured review tolerance (never auto-authorizing)'); }
  else if (variance * 1_000n <= (payment.amountMinor > invoice.amountMinor ? payment.amountMinor : invoice.amountMinor) * 5n) { score += 12; evidence.push('Amount within 0.5% (review only)'); }
  if (payment.email && invoice.email && payment.email === invoice.email) { score += 12; evidence.push('Customer email exact'); }
  if (payment.customerId && invoice.customerId && key(payment.customerId) === key(invoice.customerId)) { score += 12; evidence.push('Customer ID exact'); }
  const dayGap = daysBetween(payment.date, invoice.date);
  if (dayGap <= 1) { score += 10; evidence.push('Date within 24 hours'); }
  else if (dayGap <= options.date_window_days) { score += 5; evidence.push(`Date within ${options.date_window_days} days`); }
  const invalidStatus = ['void','voided','cancelled','canceled'].includes(invoice.status);
  if (invalidStatus) { score -= 80; evidence.push('Invoice is void or cancelled'); }
  const paymentStateSafe = !payment.status || completedPaymentStates.has(payment.status);
  if (!paymentStateSafe) evidence.push(`Payment state ${payment.status} does not prove a completed payment`);
  return { left: payment, right: invoice, score: Math.max(0, Math.min(99, score)), evidence, reason: evidence.join(' · '), autoEligible:amountSafe && payment.amountMinor > 0n && invoice.amountMinor > 0n && !invalidStatus && paymentStateSafe };
}

function scoreSettlementBank(settlement: CanonicalRecord, bank: CanonicalRecord, options: ReconciliationOptions): Candidate {
  let score = 0;
  const evidence: string[] = [];
  if (settlement.currency && bank.currency && settlement.currency !== bank.currency) return { left:settlement,right:bank,score:0,evidence:['Currency mismatch'],reason:'Currency mismatch',autoEligible:false };
  if (settlement.merchantId && bank.merchantId && key(settlement.merchantId) !== key(bank.merchantId)) return { left:settlement,right:bank,score:0,evidence:['Merchant scope mismatch'],reason:'Merchant scope mismatch',autoEligible:false };
  if (bank.amountMinor <= 0n || settlement.amountMinor <= 0n || (bank.direction && bank.direction !== 'credit')) return { left:settlement,right:bank,score:0,evidence:['Bank transaction is not a positive credit'],reason:'Bank transaction is not a positive credit',autoEligible:false };
  if (settlement.utr && bank.utr && key(settlement.utr) !== key(bank.utr)) return {left:settlement,right:bank,score:0,evidence:['Conflicting UTR identifiers'],reason:'Conflicting UTR identifiers',autoEligible:false};
  if (settlement.utr && bank.utr && key(settlement.utr) === key(bank.utr)) { score += 70; evidence.push('UTR exact'); }
  if (containsToken(bank.reference, settlement.id) || containsToken(bank.narration, settlement.id) || containsToken(settlement.reference, bank.id)) { score += 55; evidence.push('Settlement reference found in bank feed'); }
  const variance = absMinor(settlement.amountMinor - bank.amountMinor);
  const tolerance = toleranceToMinor(options.amount_tolerance, settlement.amountExponent);
  const amountSafe = variance === 0n;
  if (amountSafe) { score += 25; evidence.push('Net amount exact to the minor unit'); }
  else if (variance <= tolerance) { score += 15; evidence.push('Net amount inside configured review tolerance (never auto-authorizing)'); }
  else if (variance * 10_000n <= (settlement.amountMinor > bank.amountMinor ? settlement.amountMinor : bank.amountMinor) * 25n) { score += 12; evidence.push('Net amount within 0.25% (review only)'); }
  const dayGap = daysBetween(settlement.date, bank.date);
  if (dayGap <= 1) { score += 10; evidence.push('Credit inside settlement window'); }
  else if (dayGap <= options.date_window_days) { score += 5; evidence.push(`Credit within ${options.date_window_days} days`); }
  const classification = classifyNarration(bank.narration || bank.reference);
  if (classification.label === 'settlement' && classification.confidence >= 0.45) {
    score += 3;
    evidence.push(`Narration model: settlement (${Math.round(classification.confidence * 100)}%)`);
  }
  const settlementStateSafe = !settlement.status || completedSettlementStates.has(settlement.status);
  if (!settlementStateSafe) evidence.push(`Settlement state ${settlement.status} does not prove completion`);
  return { left: settlement, right: bank, score: Math.max(0, Math.min(99, score)), evidence, reason: evidence.join(' · '), autoEligible:amountSafe && settlementStateSafe };
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
    const tolerance = toleranceToMinor(options.amount_tolerance, record.amountExponent);
    addIndex(byAmount, `${scopeKey(record)}|${amountBucket(record.amountMinor, tolerance)}`, record);
    if (record.email) addIndex(byEmail, `${scopeKey(record)}|${key(record.email)}`, record);
    if (record.customerId) addIndex(byCustomer, `${scopeKey(record)}|${key(record.customerId)}`, record);
  });
  return (left: CanonicalRecord) => {
    const candidates = new Set<CanonicalRecord>();
    let overflow = false;
    const addBucket = (bucket?: CanonicalRecord[]) => {
      if (!bucket) return;
      if (bucket.length > options.max_candidate_bucket) { overflow = true; return; }
      for (const record of bucket) candidates.add(record);
    };
    if (domain === 'payment_to_invoice') {
      addBucket(byId.get(key(left.invoiceId)));
      addBucket(byPayment.get(key(left.id)));
      if (left.orderId) addBucket(byOrder.get(`${scopeKey(left)}|${key(left.orderId)}`));
      if (left.email) addBucket(byEmail.get(`${scopeKey(left)}|${key(left.email)}`));
      if (left.customerId) addBucket(byCustomer.get(`${scopeKey(left)}|${key(left.customerId)}`));
    } else {
      addBucket(byUtr.get(key(left.utr)));
      addBucket(byId.get(key(left.reference)));
    }
    const tolerance = toleranceToMinor(options.amount_tolerance, left.amountExponent);
    const bucket = amountBucket(left.amountMinor, tolerance);
    for (const offset of [-1n, 0n, 1n]) addBucket(byAmount.get(`${scopeKey(left)}|${bucket + offset}`));
    return {candidates:[...candidates],overflow};
  };
}

function toMatch(candidate: Candidate, domain: DecisionRecord['domain']): DecisionRecord {
  return {
    id: candidate.left.id,
    source: `${candidate.left.source} ↔ ${candidate.right.source}`,
    reference: candidate.right.id,
    amount: candidate.left.amount,
    amount_minor: candidate.left.amountMinor.toString(),
    currency:candidate.left.currency,
    status: 'Matched',
    confidence: candidate.score,
    date: candidate.left.dateLabel,
    reason: candidate.reason,
    action: 'Reconciliation verified. Any downstream posting needs a separately authorized, durable workflow.',
    evidence: candidate.evidence,
    domain,
    matched_with: candidate.right.id,
  };
}

function toException(record: CanonicalRecord, domain: DecisionRecord['domain'], status: 'Review' | 'Blocked', candidate?: Candidate, reviewThreshold = DEFAULTS.review_threshold): DecisionRecord {
  const reason = candidate
    ? candidate.score >= reviewThreshold
      ? `Candidate ${candidate.right.id} is plausible but not safe to auto-match.`
      : 'No candidate passed the review threshold.'
    : 'No supported identifier, amount, or date combination produced a safe candidate.';
  return {
    id: record.id,
    source: record.source,
    reference: candidate?.right.id ?? '—',
    amount: record.amount,
    amount_minor: record.amountMinor.toString(),
    currency:record.currency,
    status,
    confidence: candidate?.score ?? 0,
    date: record.dateLabel,
    reason,
    action: status === 'Review' ? 'Present the evidence to a finance operator; do not post automatically.' : 'Keep unresolved and request corrected source evidence.',
    evidence: candidate?.evidence.length ? candidate.evidence : ['No safe deterministic match'],
    domain,
  };
}

function buildProposals(
  lefts: CanonicalRecord[],
  rights: CanonicalRecord[],
  domain: 'payment_to_invoice' | 'settlement_to_bank',
  options: ReconciliationOptions,
  autoBlockedLeftIds = new Set<string>(),
) {
  const candidateGenerator = buildCandidateGenerator(rights, options, domain);
  const scorer = domain === 'payment_to_invoice' ? scorePaymentInvoice : scoreSettlementBank;
  const reverse = new Map<string, Candidate[]>();
  const ranked = lefts.map((left) => {
    const generated = candidateGenerator(left);
    const candidates = generated.candidates.map((right) => {
      const candidate = scorer(left, right, options);
      if (autoBlockedLeftIds.has(key(left.id))) {
        candidate.autoEligible = false;
        candidate.evidence.push('Settlement item proof did not independently close');
      }
      return candidate;
    }).filter((candidate) => candidate.score > 0)
      .sort((a,b) => b.score - a.score || a.right.id.localeCompare(b.right.id));
    for (const candidate of candidates) {
      if (!candidate.autoEligible) continue;
      const rightKey = key(candidate.right.id);
      const rivals = reverse.get(rightKey) ?? [];
      rivals.push(candidate);
      rivals.sort((a,b) => b.score - a.score || a.left.id.localeCompare(b.left.id));
      if (rivals.length > 2) rivals.length = 2;
      reverse.set(rightKey, rivals);
    }
    // Release and verification need only the forward winner and runner-up.
    // Every eligible contender has already participated in the reverse index.
    // Retaining entire candidate graphs would unnecessarily multiply batch memory.
    return {left,candidates:candidates.slice(0,2),overflow:generated.overflow};
  }).sort((a,b) => a.left.id.localeCompare(b.left.id));
  return {ranked,reverse};
}

function reconcileDomain(
  lefts: CanonicalRecord[],
  rights: CanonicalRecord[],
  domain: 'payment_to_invoice' | 'settlement_to_bank',
  options: ReconciliationOptions,
  autoBlockedLeftIds = new Set<string>(),
): DomainResult {
  const {ranked,reverse} = buildProposals(lefts, rights, domain, options, autoBlockedLeftIds);
  const usedRight = new Set<string>();
  const resolvedIds = new Set<string>();
  const matches: DecisionRecord[] = [];
  const exceptions: DecisionRecord[] = [];
  for (const item of ranked) {
    // Eligibility is decided against the original graph, never against a graph
    // made artificially unambiguous by earlier greedy assignments.
    const top = item.candidates[0];
    const runnerUp = item.candidates[1];
    const margin = top ? top.score - (runnerUp?.score ?? 0) : 0;
    const rivals = top ? reverse.get(key(top.right.id)) ?? [] : [];
    const reverseSafe = top && rivals[0]?.left === top.left && top.score - (rivals[1]?.score ?? 0) >= options.ambiguity_margin;
    if (top && !item.overflow && top.autoEligible && top.score >= options.auto_match_threshold && margin >= options.ambiguity_margin && reverseSafe && !usedRight.has(`${top.right.source}:${top.right.id}`)) {
      usedRight.add(`${top.right.source}:${top.right.id}`);
      resolvedIds.add(`${top.left.source}:${top.left.id}`);
      resolvedIds.add(`${top.right.source}:${top.right.id}`);
      matches.push(toMatch(top, domain));
    } else if (item.overflow || (top && top.score >= options.review_threshold)) {
      const ambiguityEvidence = runnerUp && margin < options.ambiguity_margin ? [`Ambiguous: top two candidates are ${margin} points apart`] : [];
      if (item.overflow) ambiguityEvidence.push('Candidate collision limit exceeded; incomplete evidence cannot authorize a match');
      if (top && !reverseSafe && rivals.length > 1) ambiguityEvidence.push('Ambiguous: multiple source records compete for this destination');
      if (top && !top.autoEligible) ambiguityEvidence.push('Hard safety gate: amount or record state is not eligible for automatic posting');
      const exception = toException(item.left, domain, 'Review', top, options.review_threshold);
      exception.evidence = [...exception.evidence,...ambiguityEvidence];
      exceptions.push(exception);
    } else {
      exceptions.push(toException(item.left, domain, 'Blocked', top, options.review_threshold));
    }
  }
  for (const right of rights) {
    if (!resolvedIds.has(`${right.source}:${right.id}`)) {
      const rivals = reverse.get(key(right.id)) ?? [];
      const contested = rivals.length > 1 && rivals[0].score >= options.review_threshold && rivals[0].score - rivals[1].score < options.ambiguity_margin;
      const exception = toException(right, domain, contested ? 'Review' : 'Blocked');
      if (contested) exception.evidence = ['Ambiguous: multiple source records compete for this destination'];
      exceptions.push(exception);
    }
  }
  return { matches, exceptions, resolvedIds };
}

function pairKey(left: string, right: string) {
  return [key(left), key(right)].sort().join('::');
}

interface SettlementProofBuild {
  closures: SettlementClosure[];
  autoBlockedSettlementIds: Set<string>;
}

function buildSettlementClosures(
  items: RawRecord[] | undefined,
  settlements: CanonicalRecord[],
): SettlementProofBuild {
  if (items === undefined) return { closures:[], autoBlockedSettlementIds:new Set() };
  type Group = { id:string; currency:string; count:number; credit:bigint; debit:bigint; fee:bigint; tax:bigint; errors:string[] };
  const groups = new Map<string, Group>();
  const entityCounts = new Map<string,number>();
  for (const raw of items) {
    const entityId = text(pick(indexedRow(raw), ['entity_id','entityid','id']));
    if (entityId) entityCounts.set(key(entityId), (entityCounts.get(key(entityId)) ?? 0) + 1);
  }
  items.forEach((raw, index) => {
    const row = indexedRow(raw);
    const rawSettlementId = text(pick(row, ['settlement_id','settlementid']));
    const settlementId = rawSettlementId || `invalid_settlement_item_${index + 1}`;
    const groupKey = key(settlementId);
    const currency = text(pick(row, ['currency','currency_code','ccy']) ?? 'INR').toUpperCase();
    const group = groups.get(groupKey) ?? { id:settlementId, currency, count:0, credit:0n, debit:0n, fee:0n, tax:0n, errors:[] };
    group.count += 1;
    if (!rawSettlementId) group.errors.push(`item ${index + 1}: missing settlement_id`);
    if (group.currency !== currency) group.errors.push(`item ${index + 1}: mixed currencies inside one settlement`);
    const entityId = text(pick(row, ['entity_id','entityid','id']));
    if (!entityId) group.errors.push(`item ${index + 1}: missing entity_id`);
    else if ((entityCounts.get(key(entityId)) ?? 0) > 1) group.errors.push(`item ${index + 1}: duplicate entity_id ${entityId}`);
    const parseField = (aliases:string[], label:string) => {
      const value = pick(row, aliases);
      if (value === undefined) return 0n;
      try {
        const parsed = parseMoney(value, currency, true).minor;
        if (parsed < 0n) group.errors.push(`item ${index + 1}: ${label} must be non-negative`);
        return parsed;
      } catch (error) {
        group.errors.push(`item ${index + 1}: invalid ${label} (${error instanceof Error ? error.message : 'invalid value'})`);
        return 0n;
      }
    };
    const hasCredit = pick(row, ['credit']) !== undefined;
    const hasDebit = pick(row, ['debit']) !== undefined;
    if (!hasCredit && !hasDebit) group.errors.push(`item ${index + 1}: credit or debit is required`);
    group.credit += parseField(['credit'], 'credit');
    group.debit += parseField(['debit'], 'debit');
    group.fee += parseField(['fee'], 'fee');
    group.tax += parseField(['tax'], 'tax');
    groups.set(groupKey, group);
  });

  const settlementById = new Map(settlements.map((settlement) => [key(settlement.id), settlement]));
  for (const settlement of settlements) {
    const settlementKey = key(settlement.id);
    if (!groups.has(settlementKey)) groups.set(settlementKey, {
      id:settlement.id,
      currency:settlement.currency,
      count:0,
      credit:0n,
      debit:0n,
      fee:0n,
      tax:0n,
      errors:['No settlement reconciliation items supplied for this settlement'],
    });
  }
  const autoBlockedSettlementIds = new Set<string>();
  const closures = [...groups.values()].map((group):SettlementClosure => {
    const settlement = settlementById.get(key(group.id));
    if (!settlement) group.errors.push('Settlement does not exist in the settlement batch');
    if (settlement && settlement.currency !== group.currency) group.errors.push('Settlement currency differs from item currency');
    const expected = settlement?.amountMinor ?? 0n;
    const net = group.credit - group.debit;
    const delta = net - expected;
    const status: SettlementClosure['status'] = !settlement || group.count === 0
      ? 'Blocked'
      : group.errors.length || delta !== 0n
        ? 'Review'
        : 'Verified';
    if (settlement && status !== 'Verified') autoBlockedSettlementIds.add(key(settlement.id));
    const evidence = [
      `${group.count} Razorpay settlement item${group.count === 1 ? '' : 's'} grouped`,
      `Net proof ${net} minor units versus settlement ${expected}`,
      ...group.errors,
    ];
    if (!group.errors.length && delta !== 0n) evidence.push(`Net delta ${delta} fails the exact settlement proof requirement`);
    return {
      settlement_id:group.id,
      status,
      currency:group.currency,
      item_count:group.count,
      credit_minor:group.credit.toString(),
      debit_minor:group.debit.toString(),
      net_minor:net.toString(),
      expected_minor:expected.toString(),
      delta_minor:delta.toString(),
      fee_minor:group.fee.toString(),
      tax_minor:group.tax.toString(),
      evidence,
    };
  }).sort((a,b) => a.settlement_id.localeCompare(b.settlement_id));
  return { closures, autoBlockedSettlementIds };
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

function checksum(records: CanonicalRecord[], validationExceptions: DecisionRecord[], closures: SettlementClosure[], options: ReconciliationOptions) {
  const canonicalRecords = records.map((record) => ({
    source:record.source,
    id:record.id,
    amount_minor:record.amountMinor.toString(),
    currency:record.currency,
    date:record.date ?? null,
    merchant_id:record.merchantId,
    invoice_id:record.invoiceId,
    payment_id:record.paymentId,
    order_id:record.orderId,
    customer_id:record.customerId,
    email:record.email,
    utr:record.utr,
    reference:record.reference,
    narration:record.narration,
    status:record.status,
    direction:record.direction,
  })).sort((a,b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  const rejectedRecords = validationExceptions.map((record) => ({source:record.source,id:record.id,amount_minor:record.amount_minor,currency:record.currency,evidence:record.evidence}))
    .sort((a,b) => `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`));
  const proof = closures.map((closure) => ({settlement_id:closure.settlement_id,currency:closure.currency,item_count:closure.item_count,credit_minor:closure.credit_minor,debit_minor:closure.debit_minor,fee_minor:closure.fee_minor,tax_minor:closure.tax_minor,status:closure.status}));
  return sha256(JSON.stringify({ruleset:RULESET,options,records:canonicalRecords,rejected_records:rejectedRecords,settlement_proof:proof})).slice(0, 16);
}

function independentlyVerify(
  checksumValue: string,
  records: CanonicalRecord[],
  validationExceptions: DecisionRecord[],
  matches: DecisionRecord[],
  exceptions: DecisionRecord[],
  closures: SettlementClosure[],
  options: ReconciliationOptions,
): VerificationResult {
  const invariants: VerificationResult['invariants'] = [];
  const check = (code:string, passed:boolean, detail:string) => invariants.push({ code, passed, detail });
  const bySourceAndId = new Map(records.map((record) => [`${record.source}:${key(record.id)}`, record]));
  const used = new Set<string>();
  let matchFactsValid = true;
  for (const match of matches) {
    const leftSource:RecordSource = match.domain === 'payment_to_invoice' ? 'Razorpay payment' : 'Razorpay settlement';
    const rightSource:RecordSource = match.domain === 'payment_to_invoice' ? 'Invoice ledger' : 'Bank statement';
    const leftKey = `${leftSource}:${key(match.id)}`;
    const rightKey = `${rightSource}:${key(match.matched_with ?? '')}`;
    const left = bySourceAndId.get(leftKey);
    const right = bySourceAndId.get(rightKey);
    const duplicate = used.has(leftKey) || used.has(rightKey);
    used.add(leftKey);
    used.add(rightKey);
    const sameCurrency = Boolean(left && right && left.currency === right.currency);
    const sameMerchant = Boolean(left && right && (!left.merchantId || !right.merchantId || key(left.merchantId) === key(right.merchantId)));
    const amountWithinTolerance = Boolean(left && right && left.amountMinor > 0n && right.amountMinor > 0n && left.amountMinor === right.amountMinor);
    const safeState = Boolean(left && right
      && !(rightSource === 'Invoice ledger' && ['void','voided','cancelled','canceled'].includes(right.status))
      && !(leftSource === 'Razorpay payment' && left.status && !completedPaymentStates.has(left.status))
      && !(leftSource === 'Razorpay settlement' && left.status && !completedSettlementStates.has(left.status))
      && !(rightSource === 'Bank statement' && right.direction && right.direction !== 'credit'));
    const decisionExact = Boolean(left && match.amount_minor === left.amountMinor.toString() && match.currency === left.currency);
    if (!left || !right || duplicate || !sameCurrency || !sameMerchant || !amountWithinTolerance || !safeState || !decisionExact) matchFactsValid = false;
  }
  check('MATCH_FACTS', matchFactsValid, `${matches.length} proposed matches independently re-read from canonical records`);
  check('ONE_TO_ONE', used.size === matches.length * 2, `${used.size} unique endpoints for ${matches.length} pairs`);
  const confidenceGate = matches.every((match) => match.confidence >= options.auto_match_threshold);
  check('CONFIDENCE_GATE', confidenceGate, `Every released match meets the configured ${options.auto_match_threshold}-point threshold`);
  let evidenceSafe = true;
  for (const domain of ['payment_to_invoice','settlement_to_bank'] as const) {
    const proposed = matches.filter((match) => match.domain === domain);
    if (!proposed.length) continue;
    const leftSource = domain === 'payment_to_invoice' ? 'Razorpay payment' : 'Razorpay settlement';
    const rightSource = domain === 'payment_to_invoice' ? 'Invoice ledger' : 'Bank statement';
    // Rebuild evidence from canonical records rather than trusting the matcher's
    // chosen endpoints, stored score, or post-assignment candidate availability.
    const blocked = domain === 'settlement_to_bank' ? new Set(closures.filter((closure) => closure.status !== 'Verified').map((closure) => key(closure.settlement_id))) : new Set<string>();
    const {ranked,reverse} = buildProposals(records.filter((r) => r.source === leftSource), records.filter((r) => r.source === rightSource), domain, options, blocked);
    const byLeft = new Map(ranked.map((item) => [key(item.left.id),item]));
    for (const match of proposed) {
      const item = byLeft.get(key(match.id));
      const best = item?.candidates[0];
      const rivals = best ? reverse.get(key(best.right.id)) ?? [] : [];
      if (!item || item.overflow || !best || !best.autoEligible
        || key(best.right.id) !== key(match.matched_with ?? '')
        || best.score !== match.confidence || best.score < options.auto_match_threshold
        || best.score - (item.candidates[1]?.score ?? 0) < options.ambiguity_margin
        || rivals[0]?.left !== best.left
        || best.score - (rivals[1]?.score ?? 0) < options.ambiguity_margin) evidenceSafe = false;
    }
  }
  check('BIDIRECTIONAL_EVIDENCE', evidenceSafe, 'Scores, source eligibility, collision completeness and ambiguity in both directions re-evaluated before release');
  const coreInputCount = records.length + validationExceptions.length;
  const decisionsAccounted = matches.length * 2 + exceptions.length;
  check('NO_SILENT_DROPS', decisionsAccounted === coreInputCount, `${decisionsAccounted}/${coreInputCount} core records have an explicit decision`);
  const uniqueExceptionEndpoints = new Set(exceptions.map((item) => `${item.source}:${key(item.id)}`));
  check('UNIQUE_DECISIONS', uniqueExceptionEndpoints.size === exceptions.length && [...uniqueExceptionEndpoints].every((endpoint) => !used.has(endpoint)), 'No endpoint is both matched and excepted, or excepted twice');
  const rejectedByEndpoint = new Map(validationExceptions.map((item) => [`${item.source}:${key(item.id)}`,item]));
  const exceptionFacts = exceptions.every((item) => {
    if (!['Review','Blocked'].includes(item.status)) return false;
    const endpoint = `${item.source}:${key(item.id)}`;
    const original = bySourceAndId.get(endpoint);
    const rejected = rejectedByEndpoint.get(endpoint);
    if (item.domain === 'validation') return Boolean(rejected && item.status === 'Blocked' && item.amount_minor === rejected.amount_minor && item.currency === rejected.currency);
    return Boolean(original && item.amount_minor === original.amountMinor.toString() && item.currency === original.currency);
  });
  check('EXCEPTION_FACTS', exceptionFacts, 'Every exception belongs to an actual normalized or rejected input, with unchanged money and currency');
  const closureSafety = closures.every((closure) => closure.status !== 'Verified' || BigInt(closure.delta_minor) === 0n);
  const proofDetail = closures.length
    ? `${closures.filter((item) => item.status === 'Verified').length}/${closures.length} settlement closures verified without unsafe deltas`
    : 'No settlement recon evidence supplied; aggregate settlement proof was not evaluated.';
  check('SETTLEMENT_PROOF', closureSafety, proofDetail);
  const closureBySettlement = new Map(closures.map((closure) => [key(closure.settlement_id), closure]));
  const releaseGate = matches.filter((match) => match.domain === 'settlement_to_bank').every((match) => {
    if (!closures.length) return true;
    return closureBySettlement.get(key(match.id))?.status === 'Verified';
  });
  check(
    'SETTLEMENT_RELEASE_GATE',
    releaseGate,
    closures.length
      ? 'No settlement with missing or non-exact item proof was released as matched'
      : 'Settlement recon evidence is optional; when supplied, only exact aggregate closures may release.',
  );
  const failures = invariants.filter((invariant) => !invariant.passed).map((invariant) => `${invariant.code}: ${invariant.detail}`);
  const receiptPayload = {
    checksum:checksumValue,
    ruleset:RULESET,
    matches:matches.map((item) => ({domain:item.domain,id:item.id,matched_with:item.matched_with,amount_minor:item.amount_minor,currency:item.currency,confidence:item.confidence})).sort((a,b) => `${a.domain}:${a.id}`.localeCompare(`${b.domain}:${b.id}`)),
    exceptions:exceptions.map((item) => ({domain:item.domain,source:item.source,id:item.id,status:item.status,reference:item.reference})).sort((a,b) => `${a.domain}:${a.source}:${a.id}`.localeCompare(`${b.domain}:${b.source}:${b.id}`)),
    closures:closures.map((item) => ({settlement_id:item.settlement_id,status:item.status,net_minor:item.net_minor,expected_minor:item.expected_minor,delta_minor:item.delta_minor})),
    invariants:invariants.map((item) => ({code:item.code,passed:item.passed})),
  };
  return {
    status:failures.length ? 'FAIL' : 'PASS',
    verifier_version:VERIFIER_VERSION,
    receipt_sha256:sha256(JSON.stringify(receiptPayload)),
    checked_matches:matches.length,
    invariants,
    failures,
  };
}

function coverageFor(source: RecordSource, records: CanonicalRecord[], resolvedIds: Set<string>) {
  const sourceRecords = records.filter((record) => record.source === source);
  const resolved = sourceRecords.filter((record) => resolvedIds.has(`${record.source}:${record.id}`)).length;
  return { source, total: sourceRecords.length, resolved, rate: sourceRecords.length ? resolved / sourceRecords.length : 0 };
}

function resolveOptions(input: ReconciliationInput) {
  const optionKeys = new Set(['auto_match_threshold','review_threshold','ambiguity_margin','amount_tolerance','date_window_days','max_candidate_bucket']);
  const unknownOptions = Object.keys(input.options ?? {}).filter((option) => !optionKeys.has(option));
  if (unknownOptions.length) throw new ReconciliationInputError(`Unknown reconciliation options: ${unknownOptions.join(', ')}`);
  const options: ReconciliationOptions = { ...DEFAULTS, ...input.options };
  if (!Number.isFinite(options.auto_match_threshold) || options.auto_match_threshold < DEFAULTS.auto_match_threshold || options.auto_match_threshold > 99) throw new ReconciliationInputError(`auto_match_threshold cannot be weaker than ${DEFAULTS.auto_match_threshold} and must not exceed 99`);
  if (!Number.isFinite(options.review_threshold) || options.review_threshold < 0 || options.review_threshold > options.auto_match_threshold) throw new ReconciliationInputError('review_threshold must be between 0 and auto_match_threshold');
  if (!Number.isFinite(options.ambiguity_margin) || options.ambiguity_margin < DEFAULTS.ambiguity_margin || options.ambiguity_margin > 99) throw new ReconciliationInputError(`ambiguity_margin cannot be weaker than ${DEFAULTS.ambiguity_margin} and must not exceed 99`);
  if (!Number.isFinite(options.amount_tolerance) || options.amount_tolerance < 0 || options.amount_tolerance > 1_000_000) throw new ReconciliationInputError('amount_tolerance must be a finite non-negative amount');
  if (!Number.isFinite(options.date_window_days) || options.date_window_days < 0 || options.date_window_days > 365) throw new ReconciliationInputError('date_window_days must be between 0 and 365');
  if (!Number.isInteger(options.max_candidate_bucket) || options.max_candidate_bucket < 1 || options.max_candidate_bucket > 10_000) throw new ReconciliationInputError('max_candidate_bucket must be an integer between 1 and 10000');
  return options;
}

/** Verify externally supplied decisions by reconstructing source facts and candidates. */
export function verifyProposedResult(input: ReconciliationInput, proposed: Pick<ReconciliationResult,'matches'|'exceptions'|'settlement_closures'|'checksum'>): VerificationResult {
  const options = resolveOptions(input);
  const sources = [
    normalizeRows(input.payments ?? [], 'Razorpay payment'),
    normalizeRows(input.settlements ?? [], 'Razorpay settlement'),
    normalizeRows(input.bank_transactions ?? [], 'Bank statement'),
    normalizeRows(input.invoices ?? [], 'Invoice ledger'),
  ];
  const records = sources.flatMap((source) => source.records);
  const validation = sources.flatMap((source) => source.exceptions);
  const proof = buildSettlementClosures(input.settlement_recon_items, sources[1].records);
  const expectedChecksum = checksum(records, validation, proof.closures, options);
  const result = independentlyVerify(expectedChecksum, records, validation, proposed.matches, proposed.exceptions, proof.closures, options);
  const addCheck = (code:string,passed:boolean,detail:string) => {
    result.invariants.push({code,passed,detail});
    if (!passed) { result.status = 'FAIL'; result.failures.push(`${code}: ${detail}`); }
  };
  addCheck('INPUT_CHECKSUM', proposed.checksum === expectedChecksum, 'Receipt is bound to the current canonical facts and policy');
  addCheck('SUPPLIED_SETTLEMENT_PROOF', JSON.stringify(proposed.settlement_closures) === JSON.stringify(proof.closures), 'Settlement proof reconstructed from supplied source evidence');
  return result;
}

export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const started = performance.now();
  const options = resolveOptions(input);
  const paymentResult = normalizeRows(input.payments ?? [], 'Razorpay payment');
  const settlementResult = normalizeRows(input.settlements ?? [], 'Razorpay settlement');
  const bankResult = normalizeRows(input.bank_transactions ?? [], 'Bank statement');
  const invoiceResult = normalizeRows(input.invoices ?? [], 'Invoice ledger');
  const allRecords = [...paymentResult.records, ...settlementResult.records, ...bankResult.records, ...invoiceResult.records];
  for (const exponent of new Set(allRecords.map((record) => record.amountExponent))) {
    try { toleranceToMinor(options.amount_tolerance, exponent); }
    catch { throw new ReconciliationInputError(`amount_tolerance has too much precision for a currency in this batch`); }
  }
  const validationExceptions = [...paymentResult.exceptions, ...settlementResult.exceptions, ...bankResult.exceptions, ...invoiceResult.exceptions];
  const settlementProof = buildSettlementClosures(input.settlement_recon_items, settlementResult.records);
  const paymentDomain = reconcileDomain(paymentResult.records, invoiceResult.records, 'payment_to_invoice', options);
  const settlementDomain = reconcileDomain(settlementResult.records, bankResult.records, 'settlement_to_bank', options, settlementProof.autoBlockedSettlementIds);
  const matches = [...paymentDomain.matches, ...settlementDomain.matches];
  const exceptions = [...validationExceptions, ...paymentDomain.exceptions, ...settlementDomain.exceptions];
  const resolvedIds = new Set([...paymentDomain.resolvedIds, ...settlementDomain.resolvedIds]);
  const evaluation = evaluate(matches, input.ground_truth);
  const classifierEvaluation = evaluateNarrationClassifier();
  const proofItemCount = input.settlement_recon_items?.length ?? 0;
  const coreInputRecords = (input.payments?.length ?? 0) + (input.settlements?.length ?? 0) + (input.bank_transactions?.length ?? 0) + (input.invoices?.length ?? 0);
  const processedRecords = coreInputRecords + proofItemCount;
  const matchedRecords = matches.length * 2;
  const reviewRecords = exceptions.filter((record) => record.status === 'Review').length;
  const blockedRecords = exceptions.filter((record) => record.status === 'Blocked').length;
  const generatedAt = new Date().toISOString();
  const batchChecksum = checksum(allRecords, validationExceptions, settlementProof.closures, options);
  const valueByCurrencyMap = new Map<string,{minor:bigint;exponent:number}>();
  for (const match of matches) {
    const current = valueByCurrencyMap.get(match.currency) ?? {minor:0n,exponent:currencyExponent(match.currency)};
    current.minor += BigInt(match.amount_minor);
    valueByCurrencyMap.set(match.currency, current);
  }
  const valueByCurrency = [...valueByCurrencyMap.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([currency,value]) => ({
    currency,
    minor:value.minor.toString(),
    decimal:minorToDecimal(value.minor, value.exponent),
  }));
  const singleCurrencyValue = valueByCurrency.length === 1 ? valueByCurrency[0] : null;
  const verification = independentlyVerify(batchChecksum, allRecords, validationExceptions, matches, exceptions, settlementProof.closures, options);
  if (verification.status !== 'PASS') throw new Error(`Independent verification failed: ${verification.failures.join('; ')}`);
  const metrics: ReconciliationMetrics = {
    input_records: coreInputRecords,
    processed_records:processedRecords,
    normalized_records: allRecords.length,
    settlement_recon_items:proofItemCount,
    matched_pairs: matches.length,
    matched_records: matchedRecords,
    review_records: reviewRecords,
    blocked_records: blockedRecords,
    exception_records: exceptions.length,
    input_resolution_rate: coreInputRecords ? matchedRecords / coreInputRecords : 0,
    match_rate: allRecords.length ? matchedRecords / allRecords.length : 0,
    value_reconciled: singleCurrencyValue ? Number(singleCurrencyValue.decimal) : null,
    value_reconciled_minor:singleCurrencyValue?.minor ?? '',
    value_reconciled_decimal:singleCurrencyValue?.decimal ?? '',
    value_reconciled_by_currency:valueByCurrency,
    duration_ms: null,
    duration_scope: 'engine_including_verification',
    throughput_records_per_second: null,
    precision: evaluation.precision,
    recall: evaluation.recall,
    f1: evaluation.f1,
    false_auto_match_rate: evaluation.falseRate,
    ground_truth_pairs: evaluation.truthCount,
    silent_drops: coreInputRecords - allRecords.length - validationExceptions.length,
    narration_classifier_accuracy: classifierEvaluation.accuracy,
    narration_classifier_holdout_size: classifierEvaluation.total,
  };
  const now = new Date(generatedAt).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Kolkata'});
  const result: ReconciliationResult = {
    run_id: `CP-${batchChecksum}`,
    engine_version: ENGINE_VERSION,
    ruleset: RULESET,
    generated_at: generatedAt,
    checksum: batchChecksum,
    metrics,
    matches,
    exceptions,
    audit: [
      { time:now, title:'Run completed', copy:'', tone:'done' },
      { time:now, title:'Safety gates applied', copy:`${reviewRecords} records require review and ${blockedRecords} remain blocked. No low-confidence write was executed.`, tone:exceptions.length ? 'warn' : 'done' },
      { time:now, title:'Narration model evaluated', copy:`Local classifier scored ${classifierEvaluation.correct}/${classifierEvaluation.total} on its small synthetic phrase holdout. This is separate from financial-decision accuracy.`, tone:'ai' },
      { time:now, title:'Cross-source indexes built', copy:'Candidate generation used identifier and bounded amount indexes; no Cartesian product scan was performed.', tone:'done' },
      { time:now, title:'Batch accepted', copy:`Ruleset ${RULESET}; checksum ${batchChecksum}; zero silent drops.`, tone:'neutral' },
    ],
    source_coverage: [
      coverageFor('Razorpay payment', allRecords, resolvedIds),
      coverageFor('Razorpay settlement', allRecords, resolvedIds),
      coverageFor('Bank statement', allRecords, resolvedIds),
      coverageFor('Invoice ledger', allRecords, resolvedIds),
      {
        source:'Razorpay settlement recon',
        total:proofItemCount,
        resolved:settlementProof.closures.filter((closure) => closure.status === 'Verified').reduce((sum, closure) => sum + closure.item_count, 0),
        rate:proofItemCount ? settlementProof.closures.filter((closure) => closure.status === 'Verified').reduce((sum, closure) => sum + closure.item_count, 0) / proofItemCount : 0,
      },
    ],
    settlement_closures:settlementProof.closures,
    verification,
    agent_execution:{
      model:'bounded_autonomous_state_machine',
      mode:'read_only',
      status:'COMPLETED',
      release_policy:'verify_before_release',
      stages:[
        {stage:'INGEST',status:'PASS',records_in:processedRecords,records_out:processedRecords,detail:'Accepted bounded JSON records without mutating any source system.'},
        {stage:'NORMALIZE',status:'PASS',records_in:coreInputRecords,records_out:allRecords.length,detail:`Canonicalized exact-money facts and surfaced ${validationExceptions.length} schema exceptions.`},
        {stage:'PROPOSE',status:'PASS',records_in:allRecords.length,records_out:matches.length + exceptions.length,detail:'Generated candidates through bounded indexes and hard financial safety gates.'},
        {stage:'PROVE_SETTLEMENTS',status:'PASS',records_in:proofItemCount,records_out:settlementProof.closures.length,detail:proofItemCount
          ? 'Aggregated Razorpay credits and debits; only exact net closures were verified.'
          : 'No settlement recon evidence was supplied; aggregate settlement proof was not evaluated.'},
        {stage:'VERIFY',status:'PASS',records_in:matches.length,records_out:matches.length,detail:`Independent verifier passed ${verification.invariants.length} invariants; receipt ${verification.receipt_sha256}.`},
        {stage:'RELEASE',status:'PASS',records_in:matches.length + exceptions.length,records_out:matches.length + exceptions.length,detail:'Released measured matches and an honest exception queue; performed no financial writes.'},
      ],
    },
  };
  // Measure the complete engine, including checksums, verification and response
  // assembly. HTTP parsing, JSON encoding and transport are outside this scope.
  const measuredDuration = performance.now() - started;
  const duration = measuredDuration >= 1 ? measuredDuration : null;
  metrics.duration_ms = duration;
  metrics.throughput_records_per_second = duration === null ? null : processedRecords / (duration / 1000);
  result.audit[0].copy = duration === null
    ? `${processedRecords.toLocaleString('en-IN')} primary and evidence records processed; the hosted clock was too coarse for a trustworthy runtime measurement. ${matches.length} pairs verified.`
    : `${processedRecords.toLocaleString('en-IN')} primary and evidence records processed and verified in ${duration.toFixed(2)} ms; ${matches.length} pairs verified.`;
  return result;
}

export const reconciliationDefaults = DEFAULTS;
