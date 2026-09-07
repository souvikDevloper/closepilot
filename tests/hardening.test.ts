import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, verifyProposedResult, type ReconciliationInput } from '../lib/reconciliation.ts';
import { classifyNarration } from '../lib/narration-classifier.ts';
import { parseMoney } from '../lib/money.ts';

const summarize = (input: ReconciliationInput) => {
  const result = reconcile(input);
  assert.equal(result.verification.status, 'PASS');
  assert.equal(result.metrics.silent_drops, 0);
  assert.equal(result.matches.length * 2 + result.exceptions.length, result.metrics.input_records);
  return result;
};

test('competing payments cannot win the same invoice by record order or identifier', () => {
  const payments = [
    {id:'pay_a',invoice_id:'inv_one',amount:'100.00',status:'captured'},
    {id:'pay_z',invoice_id:'inv_one',amount:'100.00',status:'captured'},
  ];
  for (const rows of [payments, [...payments].reverse()]) {
    const result = summarize({payments:rows,invoices:[{id:'inv_one',amount:'100.00'}]});
    assert.equal(result.matches.length, 0);
    assert.ok(result.exceptions.every((item) => item.status === 'Review'));
  }
});

test('competing settlements cannot consume a shared bank credit', () => {
  const result = summarize({
    settlements:[{id:'s_a',utr:'UTR-SHARED',amount:100},{id:'s_b',utr:'UTR-SHARED',amount:100}],
    bank_transactions:[{id:'b_one',utr:'UTR-SHARED',credit:100}],
  });
  assert.equal(result.matches.length, 0);
});

test('failed, authorized, pending, refunded and unknown payment states never clear invoices', () => {
  for (const status of ['failed','authorized','created','pending','refunded','reversed','cancelled','typo_status']) {
    const result = summarize({payments:[{id:'pay_state',invoice_id:'inv_state',amount:100,status}],invoices:[{id:'inv_state',amount:100}]});
    assert.equal(result.matches.length, 0, status);
  }
  const valid = summarize({payments:[{id:'pay_ok',invoice_id:'inv_ok',amount:100,status:'captured'}],invoices:[{id:'inv_ok',amount:100}]});
  assert.equal(valid.matches.length, 1);
});

test('negative amounts remain signed and cannot clear positive obligations', () => {
  for (const amount of ['-100.00','(100.00)']) {
    const result = summarize({payments:[{id:'pay_negative',invoice_id:'inv_positive',amount}],invoices:[{id:'inv_positive',amount:'100.00'}]});
    assert.equal(result.matches.length, 0);
    assert.equal(result.exceptions.find((item) => item.id === 'pay_negative')?.amount_minor, '-10000');
  }
  const negativeInvoice = summarize({payments:[{id:'pay',invoice_id:'inv',amount:100}],invoices:[{id:'inv',amount:-100}]});
  assert.equal(negativeInvoice.matches.length, 0);
  const negativeSettlement = summarize({settlements:[{id:'setl',utr:'REF',amount:-100}],bank_transactions:[{id:'bank',utr:'REF',credit:100}]});
  assert.equal(negativeSettlement.matches.length, 0);
});

test('bank signs and contradictory debit/credit columns cannot be overridden by labels', () => {
  for (const bank of [
    {id:'bank',utr:'REF',amount:-100,type:'credit'},
    {id:'bank',utr:'REF',credit:100,debit:100},
    {id:'bank',utr:'REF',credit:100,type:'debit'},
  ]) {
    const result = summarize({settlements:[{id:'setl',utr:'REF',amount:100}],bank_transactions:[bank]});
    assert.equal(result.matches.length, 0);
  }
});

test('contradictory direct identifiers cannot be outscored by other evidence', () => {
  const result = summarize({
    payments:[{id:'pay',invoice_id:'another_invoice',amount:100}],
    invoices:[{id:'inv',payment_id:'pay',amount:100}],
  });
  assert.equal(result.matches.length, 0);
  const settlement = summarize({
    settlements:[{id:'setl_conflict',utr:'UTR-A',amount:100,created_at:'2026-09-07'}],
    bank_transactions:[{id:'bank',utr:'UTR-B',reference:'setl_conflict',credit:100,posted_at:'2026-09-07'}],
  });
  assert.equal(settlement.matches.length, 0);
});

test('oversized strong-reference buckets withhold matches even with another useful index', () => {
  const invoices = Array.from({length:70}, (_, i) => ({id:`inv_${i}`,payment_id:'pay_collision',amount:i === 0 ? 100 : 1000 + i}));
  const result = summarize({payments:[{id:'pay_collision',invoice_id:'inv_0',amount:100}],invoices});
  assert.equal(result.matches.length, 0);
  assert.match(result.exceptions.find((item) => item.id === 'pay_collision')?.evidence.join(' ') ?? '', /candidate.*limit|collision/i);
});

test('ground truth scores decisions but never changes matching or verification', () => {
  const input = {payments:[{id:'pay',invoice_id:'inv',amount:100}],invoices:[{id:'inv',amount:100}]};
  const blind = summarize(input);
  const wrongLabels = summarize({...input,ground_truth:[{left_id:'pay',right_id:'wrong'}]});
  assert.deepEqual(blind.matches, wrongLabels.matches);
  assert.equal(blind.verification.receipt_sha256, wrongLabels.verification.receipt_sha256);
  assert.equal(wrongLabels.metrics.precision, 0);
});

test('engine timing includes verification receipt construction', (t) => {
  let clock = 0;
  const stringify = JSON.stringify.bind(JSON);
  t.mock.method(performance, 'now', () => clock);
  t.mock.method(JSON, 'stringify', (value: unknown, ...rest: unknown[]) => {
    if (value && typeof value === 'object' && 'invariants' in value && 'ruleset' in value) clock += 50;
    return Reflect.apply(stringify, JSON, [value, ...rest]);
  });
  const result = summarize({payments:[{id:'pay',invoice_id:'inv',amount:100}],invoices:[{id:'inv',amount:100}]});
  assert.ok((result.metrics.duration_ms ?? 0) >= 50);
});

test('verifier rejects forged scores and stale successful decisions on failed source facts', () => {
  const input = {payments:[{id:'pay',invoice_id:'inv',amount:100,status:'captured'}],invoices:[{id:'inv',amount:100}]};
  const good = reconcile(input);
  assert.equal(verifyProposedResult(input,good).status,'PASS');
  const forged = structuredClone(good);
  forged.matches[0].confidence = 99;
  assert.equal(verifyProposedResult(input,forged).status,'FAIL');
  const changed = {...input,payments:[{...input.payments[0],status:'failed'}]};
  assert.equal(verifyProposedResult(changed,good).status,'FAIL');
  const signed = {...input,payments:[{...input.payments[0],amount:-100}]};
  assert.equal(verifyProposedResult(signed,good).status,'FAIL');
});

test('verifier catches a forged one-to-one winner despite balanced record accounting', () => {
  const input = {payments:[{id:'pay_a',invoice_id:'inv',amount:100},{id:'pay_b',invoice_id:'inv',amount:100}],invoices:[{id:'inv',amount:100}]};
  const result = reconcile(input);
  const single = reconcile({...input,payments:[input.payments[0]]});
  const forged = {...result,matches:single.matches,exceptions:result.exceptions.filter((item) => item.id === 'pay_b')};
  const verified = verifyProposedResult(input,forged);
  assert.equal(verified.invariants.find((item) => item.code === 'NO_SILENT_DROPS')?.passed,true);
  assert.equal(verified.invariants.find((item) => item.code === 'BIDIRECTIONAL_EVIDENCE')?.passed,false);
  assert.equal(verified.status,'FAIL');
});

test('run identity includes status, reference and configured policy', () => {
  const input = {payments:[{id:'pay',invoice_id:'inv',amount:100,status:'captured'}],invoices:[{id:'inv',amount:100}]};
  const original = reconcile(input);
  assert.notEqual(reconcile({...input,payments:[{...input.payments[0],status:'failed'}]}).checksum,original.checksum);
  assert.notEqual(reconcile({...input,payments:[{...input.payments[0],invoice_id:'other'}]}).checksum,original.checksum);
  assert.notEqual(reconcile({...input,options:{auto_match_threshold:96}}).checksum,original.checksum);
});

test('references preserve punctuation and cannot match longer identifier substrings', () => {
  const opaque = summarize({payments:[{id:'pay',invoice_id:'inv-001',amount:100}],invoices:[{id:'inv_001',amount:100}]});
  assert.equal(opaque.matches.length,0);
  const prefix = summarize({settlements:[{id:'setl_001',amount:100,created_at:'2026-09-07'}],bank_transactions:[{id:'bank',reference:'setl_001_extra',credit:100,posted_at:'2026-09-07'}]});
  assert.equal(prefix.matches.length,0);
});

test('unseen and empty narration abstains instead of returning confident intent', () => {
  for (const narration of ['', 'ZXQW 998182 AABBCC', 'xylophone '.repeat(200)]) {
    const result = classifyNarration(narration);
    assert.equal(result.label,'unknown');
    assert.equal(result.abstained,true);
    assert.equal(result.confidence,0);
  }
});

test('settlement proof tampering is rejected by the public verifier', () => {
  const input = {settlements:[{id:'setl',utr:'UTR-01',amount:100}],bank_transactions:[{id:'bank',utr:'UTR-01',credit:100}],settlement_recon_items:[{entity_id:'p',settlement_id:'setl',credit:10000,debit:0}]};
  const result = reconcile(input);
  result.settlement_closures[0].net_minor = '10001';
  assert.equal(verifyProposedResult(input,result).status,'FAIL');
});

test('balanced exception counts cannot hide a substituted or altered input', () => {
  const input={payments:[{id:'pay_orphan',amount:100}],invoices:[]};
  const result=reconcile(input);
  assert.equal(verifyProposedResult(input,result).status,'PASS');
  const substituted=structuredClone(result);
  substituted.exceptions[0].id='not_an_input';
  assert.equal(verifyProposedResult(input,substituted).status,'FAIL');
  const altered=structuredClone(result);
  altered.exceptions[0].amount_minor='1';
  assert.equal(verifyProposedResult(input,altered).status,'FAIL');
});

test('oversized money strings are rejected before BigInt construction', () => {
  assert.throws(()=>parseMoney('9'.repeat(100000)),/too long/);
  const result=summarize({payments:[{id:'huge',amount:'9'.repeat(100000)}]});
  assert.equal(result.exceptions.length,1);
  assert.equal(result.exceptions[0].domain,'validation');
});

test('10,000-way UTR collisions produce no arbitrary winner or silent drops', () => {
  const input={
    settlements:Array.from({length:10000},(_,i)=>({id:`s_${i}`,utr:'COLLISION',amount:100})),
    bank_transactions:Array.from({length:10000},(_,i)=>({id:`b_${i}`,utr:'COLLISION',credit:100})),
  };
  const result=summarize(input);
  assert.equal(result.matches.length,0);
  assert.equal(result.exceptions.length,20000);
  assert.match(result.exceptions[0].evidence.join(' '),/collision limit/i);
});
