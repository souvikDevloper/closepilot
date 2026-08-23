import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchmarkDataset } from '../lib/benchmark.ts';
import { ReconciliationInputError, reconcile } from '../lib/reconciliation.ts';
import { classifyNarration, evaluateNarrationClassifier } from '../lib/narration-classifier.ts';
import { minorToDecimal, parseMoney } from '../lib/money.ts';
import { sha256 } from '../lib/sha256.ts';

test('1,000-record holdout produces perfect pair quality and honest exceptions', () => {
  const result = reconcile(createBenchmarkDataset());
  assert.equal(result.metrics.input_records, 1_000);
  assert.equal(result.metrics.processed_records, 1_325);
  assert.equal(result.metrics.settlement_recon_items, 325);
  assert.equal(result.metrics.matched_pairs, 480);
  assert.equal(result.metrics.matched_records, 960);
  assert.equal(result.metrics.exception_records, 40);
  assert.equal(result.metrics.input_resolution_rate, 0.96);
  assert.equal(result.metrics.match_rate, 0.96);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.f1, 1);
  assert.equal(result.metrics.false_auto_match_rate, 0);
  assert.equal(result.metrics.silent_drops, 0);
  assert.equal(result.settlement_closures.filter((closure) => closure.status === 'Verified').length, 165);
  assert.equal(result.verification.status, 'PASS');
});

test('ambiguous candidates are never auto-matched', () => {
  const result = reconcile({
    payments:[{id:'pay_amb',order_id:'order_same',email:'same@test.dev',amount:5000,created_at:'2026-08-21T10:00:00Z'}],
    invoices:[
      {id:'inv_a',order_id:'order_same',customer_email:'same@test.dev',amount:5000,date:'2026-08-21T10:00:00Z'},
      {id:'inv_b',order_id:'order_same',customer_email:'same@test.dev',amount:5000,date:'2026-08-21T10:00:00Z'},
    ],
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.exceptions.find((item) => item.id === 'pay_amb')?.status, 'Review');
  assert.match(result.exceptions.find((item) => item.id === 'pay_amb')?.evidence.join(' ') ?? '', /Ambiguous/);
});

test('void invoices and malformed records fail closed without silent drops', () => {
  const result = reconcile({
    payments:[
      {id:'pay_void',invoice_id:'inv_void',amount:7000,created_at:'2026-08-21T10:00:00Z'},
      {id:'pay_bad',amount:'not-an-amount'},
      {id:'pay_bad_letters_only',amount:'NOT_A_NUMBER'},
    ],
    invoices:[{id:'inv_void',payment_id:'pay_void',amount:7000,date:'2026-08-21T10:00:00Z',status:'void'}],
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.metrics.silent_drops, 0);
  assert.ok(result.exceptions.some((item) => item.id === 'pay_bad' && item.domain === 'validation'));
  assert.ok(result.exceptions.some((item) => item.id === 'pay_bad_letters_only' && item.domain === 'validation'));
});

test('common exported column aliases normalize correctly', () => {
  const result = reconcile({
    settlements:[{settlement_id:'setl_alias',settlement_amount:'₹12,500',settlement_utr:'UTR-ALIAS-1',created_at:1_787_290_000}],
    bank_transactions:[{transaction_id:'bank_alias',credit:'12500',bank_utr:'UTR-ALIAS-1',transaction_date:1_787_290_300,narration:'RZP merchant settlement'}],
    ground_truth:[{left_id:'setl_alias',right_id:'bank_alias'}],
  });
  assert.equal(result.matches.length, 1);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
});

test('local narration model is measured independently', () => {
  const evaluation = evaluateNarrationClassifier();
  assert.ok(evaluation.accuracy >= 0.8);
  assert.equal(classifyNarration('RZP settlement proceeds credited').label, 'settlement');
  assert.equal(classifyNarration('MDR processing charge GST').label, 'fee');
});

test('currency, merchant scope and bank direction are hard safety boundaries', () => {
  const crossCurrency = reconcile({
    payments:[{id:'pay_scope',invoice_id:'inv_scope',amount:5000,currency:'INR',merchant_id:'merchant_a'}],
    invoices:[{id:'inv_scope',payment_id:'pay_scope',amount:5000,currency:'USD',merchant_id:'merchant_a'}],
  });
  assert.equal(crossCurrency.matches.length, 0);

  const crossMerchant = reconcile({
    payments:[{id:'pay_merchant',invoice_id:'inv_merchant',amount:5000,currency:'INR',merchant_id:'merchant_a'}],
    invoices:[{id:'inv_merchant',payment_id:'pay_merchant',amount:5000,currency:'INR',merchant_id:'merchant_b'}],
  });
  assert.equal(crossMerchant.matches.length, 0);

  const debit = reconcile({
    settlements:[{id:'setl_debit',utr:'UTR-DEBIT',amount:8000}],
    bank_transactions:[{id:'bank_debit',utr:'UTR-DEBIT',amount:8000,type:'debit',narration:'RZP settlement'}],
  });
  assert.equal(debit.matches.length, 0);
});

test('10,000-record run preserves quality at scale', () => {
  const result = reconcile(createBenchmarkDataset(10));
  assert.equal(result.metrics.input_records, 10_000);
  assert.equal(result.metrics.processed_records, 13_250);
  assert.equal(result.metrics.matched_pairs, 4_800);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.silent_drops, 0);
});

test('money is parsed in exact minor units without floating-point drift', () => {
  const one = parseMoney('0.10', 'INR');
  const two = parseMoney('0.20', 'INR');
  assert.equal(one.minor + two.minor, 30n);
  assert.equal(minorToDecimal(one.minor + two.minor, 2), '0.30');
  assert.equal(parseMoney('(₹1,234.50)', 'INR').minor, -123450n);
  assert.equal(parseMoney('123', 'JPY').minor, 123n);
  assert.equal(parseMoney('123', 'VND').minor, 123n);
  assert.equal(parseMoney('1.234', 'KWD').minor, 1234n);
  assert.equal(parseMoney('1.2345', 'CLF').minor, 12345n);
  assert.throws(() => parseMoney('1.001', 'INR'));
  assert.throws(() => parseMoney('NOT_A_NUMBER', 'INR'));
  assert.throws(() => parseMoney('1,2,3.00', 'INR'));
  assert.throws(() => parseMoney('1 2.00', 'INR'));
});

test('SHA-256 implementation matches the published abc test vector', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a strong identifier can never override an amount mismatch', () => {
  const result = reconcile({
    payments:[{id:'pay_wrong_amount',invoice_id:'inv_wrong_amount',amount:'5000.00',currency:'INR',created_at:'2026-08-21T10:00:00Z'}],
    invoices:[{id:'inv_wrong_amount',payment_id:'pay_wrong_amount',amount:'5000.01',currency:'INR',date:'2026-08-21T10:00:00Z'}],
    options:{amount_tolerance:1_000_000},
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.exceptions.find((item) => item.id === 'pay_wrong_amount')?.status, 'Review');
  assert.equal(result.verification.status, 'PASS');
});

test('negative and debit-side bank entries fail closed', () => {
  const result = reconcile({
    settlements:[{id:'setl_negative',utr:'UTR-NEGATIVE',amount:'8000.00'}],
    bank_transactions:[{id:'bank_negative',utr:'UTR-NEGATIVE',amount:'-8000.00',narration:'RZP settlement'}],
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.verification.status, 'PASS');
  const debitColumn = reconcile({
    settlements:[{id:'setl_debit_column',utr:'UTR-DEBIT-COLUMN',amount:'8000.00'}],
    bank_transactions:[{id:'bank_debit_column',utr:'UTR-DEBIT-COLUMN',credit_amount:0,debit_amount:'8000.00',narration:'RZP settlement'}],
  });
  assert.equal(debitColumn.matches.length, 0);
});

test('Razorpay settlement items independently close the cash loop', () => {
  const result = reconcile({
    settlements:[{id:'setl_proof',utr:'UTR-PROOF',amount:'950.00',currency:'INR',created_at:'2026-08-21T10:00:00Z'}],
    bank_transactions:[{id:'bank_proof',utr:'UTR-PROOF',credit:'950.00',currency:'INR',transaction_date:'2026-08-21T12:00:00Z',narration:'RZP settlement proceeds'}],
    settlement_recon_items:[
      {entity_id:'pay_proof',settlement_id:'setl_proof',type:'payment',credit:100000,debit:0,fee:2000,tax:360,currency:'INR'},
      {entity_id:'refund_proof',settlement_id:'setl_proof',type:'refund',credit:0,debit:5000,fee:0,tax:0,currency:'INR'},
    ],
  });
  assert.equal(result.settlement_closures[0].status, 'Verified');
  assert.equal(result.settlement_closures[0].net_minor, '95000');
  assert.equal(result.matches.length, 1);
  assert.equal(result.verification.status, 'PASS');
  assert.equal(result.verification.receipt_sha256.length, 64);
});

test('a one-subunit settlement proof error blocks automatic closure', () => {
  const result = reconcile({
    settlements:[{id:'setl_tampered',utr:'UTR-TAMPERED',amount:'950.00',currency:'INR'}],
    bank_transactions:[{id:'bank_tampered',utr:'UTR-TAMPERED',credit:'950.00',currency:'INR',narration:'RZP settlement'}],
    settlement_recon_items:[
      {entity_id:'pay_tampered',settlement_id:'setl_tampered',credit:100000,debit:0,currency:'INR'},
      {entity_id:'refund_tampered',settlement_id:'setl_tampered',credit:0,debit:5001,currency:'INR'},
    ],
  });
  assert.equal(result.settlement_closures[0].status, 'Review');
  assert.equal(result.settlement_closures[0].delta_minor, '-1');
  assert.equal(result.matches.length, 0);
  assert.equal(result.exceptions.find((item) => item.id === 'setl_tampered')?.status, 'Review');
});

test('run IDs and verification receipts are deterministic for the same financial facts', () => {
  const input = {
    payments:[{id:'pay_repeat',invoice_id:'inv_repeat',amount:'10.10',currency:'INR'}],
    invoices:[{id:'inv_repeat',payment_id:'pay_repeat',amount:'10.10',currency:'INR'}],
  };
  const first = reconcile(input);
  const second = reconcile(input);
  assert.equal(first.run_id, second.run_id);
  assert.equal(first.verification.receipt_sha256, second.verification.receipt_sha256);
  assert.equal(first.metrics.value_reconciled_minor, '1010');
  assert.equal(first.metrics.value_reconciled_decimal, '10.10');
});

test('duplicate source identifiers block every duplicate occurrence', () => {
  const result = reconcile({
    payments:[{id:'pay_duplicate',amount:100},{id:'pay_duplicate',amount:100}],
    invoices:[{id:'inv_duplicate',payment_id:'pay_duplicate',amount:100}],
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.metrics.input_resolution_rate, 0);
  assert.equal(result.metrics.silent_drops, 0);
  assert.equal(result.exceptions.filter((item) => item.id.startsWith('pay_duplicate#duplicate_')).length, 2);
  assert.equal(result.verification.status, 'PASS');
});

test('missing optional settlement proof is reported as not evaluated', () => {
  const result = reconcile({
    settlements:[{id:'setl_optional',utr:'UTR-OPTIONAL',amount:'25.00'}],
    bank_transactions:[{id:'bank_optional',utr:'UTR-OPTIONAL',credit:'25.00'}],
  });
  assert.equal(result.matches.length, 1);
  assert.match(result.verification.invariants.find((item) => item.code === 'SETTLEMENT_PROOF')?.detail ?? '', /not evaluated/i);
  assert.match(result.agent_execution.stages.find((item) => item.stage === 'PROVE_SETTLEMENTS')?.detail ?? '', /not evaluated/i);
});

test('verification receipt is order-independent but changes when financial facts change', () => {
  const ordered = reconcile({
    payments:[
      {id:'pay_order_a',invoice_id:'inv_order_a',amount:'20.00'},
      {id:'pay_order_b',invoice_id:'inv_order_b',amount:'30.00'},
    ],
    invoices:[
      {id:'inv_order_a',payment_id:'pay_order_a',amount:'20.00'},
      {id:'inv_order_b',payment_id:'pay_order_b',amount:'30.00'},
    ],
  });
  const reversed = reconcile({
    payments:[
      {id:'pay_order_b',invoice_id:'inv_order_b',amount:'30.00'},
      {id:'pay_order_a',invoice_id:'inv_order_a',amount:'20.00'},
    ],
    invoices:[
      {id:'inv_order_b',payment_id:'pay_order_b',amount:'30.00'},
      {id:'inv_order_a',payment_id:'pay_order_a',amount:'20.00'},
    ],
  });
  const changed = reconcile({
    payments:[{id:'pay_order_a',invoice_id:'inv_order_a',amount:'20.01'}],
    invoices:[{id:'inv_order_a',payment_id:'pay_order_a',amount:'20.01'}],
  });
  assert.equal(ordered.run_id, reversed.run_id);
  assert.equal(ordered.verification.receipt_sha256, reversed.verification.receipt_sha256);
  assert.notEqual(ordered.verification.receipt_sha256, changed.verification.receipt_sha256);
});

test('duplicate settlement entity evidence blocks every affected settlement', () => {
  const result = reconcile({
    settlements:[
      {id:'setl_dup_a',utr:'UTR-DUP-A',amount:'10.00'},
      {id:'setl_dup_b',utr:'UTR-DUP-B',amount:'10.00'},
    ],
    bank_transactions:[
      {id:'bank_dup_a',utr:'UTR-DUP-A',credit:'10.00'},
      {id:'bank_dup_b',utr:'UTR-DUP-B',credit:'10.00'},
    ],
    settlement_recon_items:[
      {entity_id:'pay_shared',settlement_id:'setl_dup_a',credit:1000,debit:0,currency:'INR'},
      {entity_id:'pay_shared',settlement_id:'setl_dup_b',credit:1000,debit:0,currency:'INR'},
    ],
  });
  assert.deepEqual(result.settlement_closures.map((closure) => closure.status), ['Review','Review']);
  assert.equal(result.matches.length, 0);
  assert.equal(result.verification.status, 'PASS');
});

test('multi-currency batches never publish a meaningless combined value', () => {
  const result = reconcile({
    payments:[
      {id:'pay_inr',invoice_id:'inv_inr',amount:'10.00',currency:'INR'},
      {id:'pay_usd',invoice_id:'inv_usd',amount:'20.00',currency:'USD'},
    ],
    invoices:[
      {id:'inv_inr',payment_id:'pay_inr',amount:'10.00',currency:'INR'},
      {id:'inv_usd',payment_id:'pay_usd',amount:'20.00',currency:'USD'},
    ],
  });
  assert.equal(result.metrics.value_reconciled, null);
  assert.deepEqual(result.metrics.value_reconciled_by_currency, [
    {currency:'INR',minor:'1000',decimal:'10.00'},
    {currency:'USD',minor:'2000',decimal:'20.00'},
  ]);
});

test('official Razorpay entity payloads interpret amount as currency subunits', () => {
  const result = reconcile({
    payments:[{id:'pay_official',entity:'payment',invoice_id:'inv_official',amount:1250000,currency:'INR',created_at:1_787_290_000}],
    invoices:[{id:'inv_official',payment_id:'pay_official',total:'12500.00',currency:'INR',date:1_787_290_100}],
  });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].amount_minor, '1250000');
  assert.equal(result.matches[0].amount, 12500);
});

test('callers cannot weaken the automatic confidence or ambiguity policy', () => {
  assert.throws(() => reconcile({
    payments:[{id:'pay_unsafe',amount:10}],
    invoices:[{id:'inv_unsafe',amount:10}],
    options:{auto_match_threshold:1},
  }), ReconciliationInputError);
  assert.throws(() => reconcile({
    payments:[{id:'pay_unsafe',amount:10}],
    invoices:[{id:'inv_unsafe',amount:10}],
    options:{ambiguity_margin:0},
  }), ReconciliationInputError);
});
