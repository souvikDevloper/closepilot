import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchmarkDataset } from '../lib/benchmark.ts';
import { reconcile } from '../lib/reconciliation.ts';
import { classifyNarration, evaluateNarrationClassifier } from '../lib/narration-classifier.ts';

test('1,000-record holdout produces perfect pair quality and honest exceptions', () => {
  const result = reconcile(createBenchmarkDataset());
  assert.equal(result.metrics.input_records, 1_000);
  assert.equal(result.metrics.matched_pairs, 480);
  assert.equal(result.metrics.matched_records, 960);
  assert.equal(result.metrics.exception_records, 40);
  assert.equal(result.metrics.match_rate, 0.96);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.f1, 1);
  assert.equal(result.metrics.false_auto_match_rate, 0);
  assert.equal(result.metrics.silent_drops, 0);
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
  assert.equal(result.metrics.matched_pairs, 4_800);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.silent_drops, 0);
});
