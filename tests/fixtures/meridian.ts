import type { RawRecord } from '../../lib/reconciliation.ts';

/** Independently specified cases: expected labels are assigned before the engine is called. */
export function createMeridianDataset(perSource = 12_000, seed = 9072026) {
  if (!Number.isInteger(perSource) || perSource < 20 || perSource % 20 !== 0) throw new Error('perSource must be a positive multiple of 20');
  const payments: RawRecord[] = [];
  const invoices: RawRecord[] = [];
  const settlements: RawRecord[] = [];
  const bank_transactions: RawRecord[] = [];
  const settlement_recon_items: RawRecord[] = [];
  const ground_truth: Array<{left_id:string;right_id:string}> = [];
  const without_proof_truth: Array<{left_id:string;right_id:string}> = [];
  const decimal = (minor:number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2,'0')}`;
  for (let i = 0; i < perSource; i += 1) {
    const kind = i % 20;
    const token = `${seed.toString(36)}_${(i * 7919 + 103).toString(36)}`;
    const paymentId = `pay_md_${token}`;
    const invoiceId = `inv_md_${token}`;
    const merchant = `merchant_${i % 7}`;
    const currency = ['INR','USD','EUR'][i % 3];
    const paymentMinor = 10_007 + i * 137;
    const when = new Date(Date.UTC(2026,8,1) + i * 61_000).toISOString();
    payments.push({id:paymentId,entity:'payment',invoice_id:kind === 19 ? `${invoiceId}_other` : invoiceId,amount:kind === 16 ? -paymentMinor : paymentMinor,currency,merchant_id:merchant,created_at:when,status:kind === 15 ? 'failed' : 'captured'});
    invoices.push({'Invoice ID':invoiceId,'Payment ID':paymentId,'Total':decimal(paymentMinor + (kind === 18 ? 1 : 0)),'Currency':kind === 17 ? 'JPY' : currency,'Merchant ID':merchant,'Date':when,'Status':'open'});
    if (kind < 15) {
      ground_truth.push({left_id:paymentId,right_id:invoiceId});
      without_proof_truth.push({left_id:paymentId,right_id:invoiceId});
    }
    const settlementId = `setl_md_${token}`;
    const bankId = `bank_md_${token}`;
    const utr = `MD${seed}${i.toString().padStart(8,'0')}`;
    const settlementMinor = 3_000_011 + i * 233;
    settlements.push({id:settlementId,entity:'settlement',amount:settlementMinor,currency,merchant_id:merchant,utr,created_at:when,status:'processed'});
    bank_transactions.push({'Transaction ID':bankId,'Credit Amount':kind === 18 ? '0' : decimal(settlementMinor),'Debit Amount':kind === 18 ? decimal(settlementMinor) : '0','UTR':kind === 19 ? `${utr}9` : utr,'Currency':currency,'Merchant ID':merchant,'Transaction Date':when,'Narration':i % 2 ? `RZP, merchant "daily"\nsettlement ${utr}` : `NEFT / AGGREGATOR / ${utr}`});
    settlement_recon_items.push({entity_id:`entity_md_${token}`,settlement_id:settlementId,credit:settlementMinor + (kind === 17 ? 1 : 0),debit:0,fee:0,tax:0,currency});
    if (kind < 17) ground_truth.push({left_id:settlementId,right_id:bankId});
    if (kind < 18) without_proof_truth.push({left_id:settlementId,right_id:bankId});
  }
  return {payments,invoices,settlements,bank_transactions,settlement_recon_items,ground_truth,without_proof_truth};
}

export function recordsToCsv(rows: RawRecord[]) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value:unknown) => `"${String(value ?? '').replaceAll('"','""')}"`;
  return [headers.map(cell).join(','),...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\r\n');
}
