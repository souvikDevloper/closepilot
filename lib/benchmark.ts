import type { RawRecord, ReconciliationInput } from './reconciliation.ts';

const iso = (minutes: number) => new Date(Date.UTC(2026, 7, 21, 4, 0) + minutes * 60_000).toISOString();

export interface BenchmarkDataset extends ReconciliationInput {
  payments: RawRecord[];
  settlements: RawRecord[];
  bank_transactions: RawRecord[];
  invoices: RawRecord[];
  ground_truth: Array<{ left_id: string; right_id: string }>;
}

/**
 * Generates a deterministic 1,000-record holdout with four independently
 * verifiable matching patterns and deliberately ambiguous/unmatched records.
 */
export function createBenchmarkDataset(scale = 1): BenchmarkDataset {
  const paymentPairs = 320 * scale;
  const settlementPairs = 160 * scale;
  const payments: RawRecord[] = [];
  const invoices: RawRecord[] = [];
  const settlements: RawRecord[] = [];
  const bankTransactions: RawRecord[] = [];
  const groundTruth: Array<{ left_id: string; right_id: string }> = [];

  for (let index = 0; index < paymentPairs; index += 1) {
    const paymentId = `pay_holdout_${String(index + 1).padStart(6,'0')}`;
    const invoiceId = `inv_holdout_${String(index + 1).padStart(6,'0')}`;
    const orderId = `order_${String(90_000 + index)}`;
    const customerId = `cust_${String(index + 1).padStart(6,'0')}`;
    const email = `buyer${index + 1}@benchmark.test`;
    const amount = 1_000 + ((index * 7_919) % 89_000) + (index % 7) * 0.25;
    const payment: RawRecord = { id:paymentId, amount, created_at:iso(index), status:'captured' };
    const invoice: RawRecord = { id:invoiceId, amount, date:iso(index + (index % 3)), status:'open' };
    switch (index % 4) {
      case 0:
        payment.invoice_id = invoiceId;
        invoice.customer_id = customerId;
        payment.customer_id = customerId;
        break;
      case 1:
        payment.order_id = orderId;
        invoice.order_id = orderId;
        payment.email = email;
        invoice.customer_email = email;
        break;
      case 2:
        invoice.payment_id = paymentId;
        payment.reference = `Captured for ${invoiceId}`;
        break;
      default:
        payment.reference = invoiceId;
        invoice.reference = paymentId;
        payment.customer_id = customerId;
        invoice.customer_id = customerId;
    }
    payments.push(payment);
    invoices.push(invoice);
    groundTruth.push({ left_id:paymentId, right_id:invoiceId });
  }

  for (let index = 0; index < settlementPairs; index += 1) {
    const settlementId = `setl_holdout_${String(index + 1).padStart(6,'0')}`;
    const bankId = `bank_holdout_${String(index + 1).padStart(6,'0')}`;
    const utr = `UTR26${String(7_000_000 + index)}`;
    const amount = 25_000 + ((index * 11_173) % 350_000) + (index % 5) * 0.5;
    const settlement: RawRecord = { id:settlementId, amount, created_at:iso(1_000 + index), status:'processed' };
    const bank: RawRecord = { id:bankId, amount, posted_at:iso(1_000 + index + (index % 2)), type:'credit' };
    if (index % 3 === 0) {
      settlement.utr = utr;
      bank.utr = utr;
      bank.narration = `RZP merchant settlement ${utr}`;
    } else if (index % 3 === 1) {
      bank.reference = settlementId;
      bank.narration = `payment gateway settlement ${settlementId}`;
    } else {
      settlement.utr = utr;
      bank.utr = utr;
      bank.reference = settlementId;
      bank.narration = `net merchant proceeds settled ${settlementId}`;
    }
    settlements.push(settlement);
    bankTransactions.push(bank);
    groundTruth.push({ left_id:settlementId, right_id:bankId });
  }

  // Adversarial ambiguity: each payment has two equally credible invoices.
  for (let index = 0; index < 10 * scale; index += 1) {
    const paymentId = `pay_ambiguous_${index + 1}`;
    const orderId = `order_ambiguous_${index + 1}`;
    const email = `ambiguous${index + 1}@benchmark.test`;
    const amount = 710_000 + index * 1_003;
    payments.push({ id:paymentId, order_id:orderId, email, amount, created_at:iso(2_000 + index), status:'captured' });
    invoices.push(
      { id:`inv_ambiguous_${index + 1}_a`, order_id:orderId, customer_email:email, amount, date:iso(2_000 + index), status:'open' },
      { id:`inv_ambiguous_${index + 1}_b`, order_id:orderId, customer_email:email, amount, date:iso(2_000 + index), status:'open' },
    );
  }

  // Unmatched settlements and bank credits prove the engine does not force a match.
  for (let index = 0; index < 5 * scale; index += 1) {
    settlements.push({ id:`setl_unmatched_${index + 1}`, utr:`UTR_UNMATCHED_S_${index + 1}`, amount:900_000 + index * 9_001, created_at:iso(3_000 + index) });
    bankTransactions.push({ id:`bank_unmatched_${index + 1}`, utr:`UTR_UNMATCHED_B_${index + 1}`, amount:1_300_000 + index * 7_003, posted_at:iso(6_000 + index), narration:'unidentified NEFT receipt' });
  }

  return { payments, settlements, bank_transactions:bankTransactions, invoices, ground_truth:groundTruth };
}
