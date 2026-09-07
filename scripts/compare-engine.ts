import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBenchmarkDataset } from '../lib/benchmark.ts';
import { reconcile } from '../lib/reconciliation.ts';

// Optional baseline is an explicit local checkout, never fetched or executed remotely.
if (process.argv[2] === '--worker') {
    const engine = process.argv[3] ? await import(pathToFileURL(resolve(process.argv[3], 'lib/reconciliation.ts')).href) : {reconcile};
    const dataset = createBenchmarkDataset(100);
    engine.reconcile(createBenchmarkDataset(1));
    const started = performance.now();
    const result = engine.reconcile(dataset);
    const elapsed_ms = performance.now() - started;
    assert.equal(result.metrics.matched_pairs, 48000);
    assert.equal(result.metrics.exception_records, 4000);
    assert.equal(result.metrics.precision, 1);
    assert.equal(result.metrics.recall, 1);
    assert.equal(result.metrics.silent_drops, 0);
    console.log(JSON.stringify({elapsed_ms,peak_rss_kib:process.resourceUsage().maxRSS}));
} else {
  const baselinePath = process.argv[2];
  const engines = [...(baselinePath ? [{name:'submitted-v3.0',path:resolve(baselinePath)}] : []),{name:'hardened-v3.1',path:''}];
  const runs = engines.map((engine) => ({engine:engine.name,elapsed_ms:[] as number[],peak_rss_kib:[] as number[]}));
  for(let repeat=0;repeat<3;repeat++) for(let index=0;index<engines.length;index++) {
    const child=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'--worker',engines[index].path],{encoding:'utf8',timeout:90000});
    if(child.status!==0)throw new Error(child.stderr || 'Benchmark child failed or timed out.');
    const measured=JSON.parse(child.stdout);
    runs[index].elapsed_ms.push(measured.elapsed_ms);
    runs[index].peak_rss_kib.push(measured.peak_rss_kib);
  }
  const results=runs.map((run)=>{
    const median_ms=[...run.elapsed_ms].sort((a,b)=>a-b)[1];
    return {...run,median_ms,median_records_per_second:132500/(median_ms/1000)};
  });
  console.log(JSON.stringify({ node: process.version, platform: platform(), cpu: cpus()[0]?.model, measurement: 'Three isolated processes per engine, alternating versions, one warm-up; full reconcile() including verification and receipt. Excludes fixture generation, HTTP and transport. RSS is whole-process peak, not Worker memory.', processed_records: 132500, matched_pairs: 48000, exceptions: 4000, results }, null, 2));
}
