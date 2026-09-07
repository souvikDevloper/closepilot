import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadRequest, csvCell, parseCsv, parseUploadFile } from '../lib/data-lab.ts';
import { reconcile } from '../lib/reconciliation.ts';

test('Data lab imports BOM, CRLF, quoted commas, escaped quotes and multiline narration', async () => {
  const source = '\uFEFFTransaction ID,Credit,UTR,Narration\r\nbank_one,100,REF,"RZP, merchant ""daily""\nsettlement"\r\n';
  const rows = await parseUploadFile(new File([source],'bank.csv'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].Narration,'RZP, merchant "daily"\nsettlement');
  const payload = buildUploadRequest({bank_transactions:rows,settlements:[{id:'setl',utr:'REF',amount:100}]});
  assert.equal(reconcile(payload).matches.length,1);
});

test('malformed CSVs never silently shift, drop or overwrite financial columns', () => {
  for (const csv of ['id,amount\na,100,extra','id,amount\na','id,Amount,amount\na,100,999','id,,amount\na,x,100','id,amount\na,"100','id,amount\na,"100"junk','id,amount\na,1"00','']) {
    assert.throws(() => parseCsv(csv),Error,csv);
  }
});

test('Data lab rejects wrong file formats, oversize files and non-record JSON', async () => {
  for (const json of ['{}','[null]','[123]','[[1]]']) await assert.rejects(parseUploadFile(new File([json],'bad.json')));
  await assert.rejects(parseUploadFile(new File(['id,amount\na,1'],'book.xlsx')));
  let read = false;
  await assert.rejects(parseUploadFile({name:'large.csv',size:21 * 1024 * 1024,text:async () => { read = true; return ''; }}));
  assert.equal(read,false);
});

test('ground truth remains optional, empty labels are explicit and invalid labels cannot disappear', () => {
  const uploads = {payments:[{id:'pay',invoice_id:'inv',amount:100}],invoices:[{id:'inv',amount:100}]};
  assert.equal(reconcile(buildUploadRequest(uploads)).metrics.precision,null);
  assert.equal(reconcile(buildUploadRequest({...uploads,ground_truth:[]})).metrics.precision,0);
  assert.throws(() => buildUploadRequest({...uploads,ground_truth:[{left_id:'pay'}]}));
  assert.equal(reconcile(buildUploadRequest({...uploads,ground_truth:[{left:'pay',right:'inv'}]})).metrics.precision,1);
  assert.throws(() => buildUploadRequest({payments:uploads.payments}));
});

test('Data lab selects summary mode at the same boundary as the API', () => {
  const payments = Array.from({length:10000},(_,i) => ({id:`pay_${i}`,amount:i + 1}));
  const invoices = Array.from({length:10000},(_,i) => ({id:`inv_${i}`,amount:i + 1}));
  assert.equal(buildUploadRequest({payments,invoices}).response_mode,'full');
  assert.equal(buildUploadRequest({payments,invoices,settlement_recon_items:[{entity_id:'proof'}]}).response_mode,'summary');
});

test('CSV export neutralizes spreadsheet formulas including whitespace-prefixed payloads', () => {
  for (const cell of ['=HYPERLINK("x")',' +CMD','\t@SUM(1)','-100','\r=1']) assert.ok(csvCell(cell).startsWith('"\''));
  assert.equal(csvCell('ordinary, "text"'),'"ordinary, ""text"""');
});
