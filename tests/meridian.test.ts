import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeridianDataset, recordsToCsv } from './fixtures/meridian.ts';
import { buildUploadRequest, parseCsv, type UploadState } from '../lib/data-lab.ts';
import { reconcile } from '../lib/reconciliation.ts';

test('fresh mixed-source CSV fixture has independently specified financial outcomes', () => {
  for (const seed of [9072026,527,419001]) {
    const {without_proof_truth,...input} = createMeridianDataset(200,seed);
    const uploads: UploadState = {};
    for (const [source,rows] of Object.entries(input)) uploads[source as keyof UploadState] = parseCsv(recordsToCsv(rows));
    const result = reconcile(buildUploadRequest(uploads));
    assert.equal(result.metrics.processed_records,1000);
    assert.equal(result.matches.length,320);
    assert.equal(result.metrics.precision,1);
    assert.equal(result.metrics.recall,1);
    assert.equal(result.metrics.exception_records,160);
    assert.equal(result.metrics.silent_drops,0);
    const reordered = reconcile({...input,payments:[...input.payments].reverse(),bank_transactions:[...input.bank_transactions].reverse()});
    assert.equal(reordered.checksum,result.checksum);
    assert.equal(reordered.verification.receipt_sha256,result.verification.receipt_sha256);
    const noProof = reconcile({...input,settlement_recon_items:undefined,ground_truth:without_proof_truth});
    assert.equal(noProof.matches.length,330);
    assert.equal(noProof.metrics.precision,1);
  }
});
