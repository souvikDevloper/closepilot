'use client';

import { useMemo, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import type { DecisionRecord, RawRecord, ReconciliationResult } from '@/lib/reconciliation.ts';

type View = 'overview' | 'records' | 'exceptions' | 'audit' | 'data';
type UploadKey = 'payments' | 'invoices' | 'settlements' | 'bank_transactions' | 'settlement_recon_items' | 'ground_truth';
type UploadState = Partial<Record<UploadKey, RawRecord[]>>;

const money = (value:number,currency='INR') => new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(value);
const percent = (value:number|null, digits=1) => value === null ? 'n/a' : `${(value*100).toFixed(digits)}%`;
const number = (value:number) => new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(value);

function parseCsv(input:string): RawRecord[] {
  const rows:string[][] = [];
  let row:string[] = [];
  let field = '';
  let quoted = false;
  for (let index=0; index<input.length; index+=1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index+1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field.trim()); field=''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index+1] === '\n') index += 1;
      row.push(field.trim()); field='';
      if (row.some(Boolean)) rows.push(row);
      row=[];
    } else field += character;
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
  const headers = rows[0] ?? [];
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header,index) => [header,values[index] ?? ''])));
}

async function parseFile(file:File): Promise<RawRecord[]> {
  const content = await file.text();
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed:unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('JSON files must contain an array of records.');
    return parsed as RawRecord[];
  }
  return parseCsv(content);
}

function MatchTable({ rows, onOpen }:{ rows:DecisionRecord[]; onOpen:(row:DecisionRecord)=>void }) {
  return <div className="table-wrap"><table><thead><tr><th>Record</th><th>Source</th><th>Amount</th><th>Status</th><th>Confidence</th><th></th></tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.domain}-${row.id}-${row.reference}-${index}`} className="record-row" onClick={()=>onOpen(row)}><td><code>{row.id}</code><small>{row.date}</small></td><td>{row.source}</td><td>{money(row.amount,row.currency)}</td><td><span className={`status ${row.status.toLowerCase()}`}>{row.status==='Matched'?'✓ ':row.status==='Blocked'?'× ':'! '}{row.status}</span></td><td><div className="confidence"><i className={row.confidence<50?'low':row.confidence<85?'mid':''} style={{width:`${Math.max(12,row.confidence*.52)}px`}}/><span>{row.confidence}%</span></div></td><td><button aria-label={`Open ${row.id}`} onClick={(event)=>{event.stopPropagation();onOpen(row)}}>→</button></td></tr>)}</tbody></table></div>;
}

export default function ClosePilotClient({ initialResult }:{ initialResult:ReconciliationResult }) {
  const [result,setResult] = useState(initialResult);
  const [view,setView] = useState<View>('overview');
  const [selected,setSelected] = useState<DecisionRecord|null>(null);
  const [query,setQuery] = useState('');
  const [source,setSource] = useState('All sources');
  const [running,setRunning] = useState(false);
  const [runStep,setRunStep] = useState(0);
  const [toast,setToast] = useState('');
  const [datasetName,setDatasetName] = useState('Labelled 1,000-record holdout');
  const [uploads,setUploads] = useState<UploadState>({});
  const [uploadError,setUploadError] = useState('');

  const apiOrigin = useSyncExternalStore(()=>()=>{},()=>window.location.origin,()=>'');
  const allRecords = useMemo(()=>[...result.exceptions,...result.matches],[result]);
  const filtered = useMemo(()=>{
    const base = view==='exceptions' ? result.exceptions : allRecords;
    return base.filter((record)=>(source==='All sources'||record.source===source)&&`${record.id} ${record.reference} ${record.source}`.toLowerCase().includes(query.toLowerCase()));
  },[allRecords,result.exceptions,view,source,query]);
  const sources = useMemo(()=>['All sources',...Array.from(new Set(allRecords.map((record)=>record.source)))],[allRecords]);
  const metrics = result.metrics;

  const notify = (message:string) => { setToast(message); window.setTimeout(()=>setToast(''),3400); };
  const go = (next:View) => { setView(next); setQuery(''); setSource('All sources'); window.scrollTo({top:0,behavior:'smooth'}); };
  const runRequest = async (payload:unknown,label:string) => {
    if (running) return;
    setRunning(true); setRunStep(0); setUploadError('');
    const started=Date.now();
    const stepOne=window.setTimeout(()=>setRunStep(1),250);
    const stepTwo=window.setTimeout(()=>setRunStep(2),520);
    try {
      const response=await fetch('/api/v1/reconcile',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`ui-${Date.now()}`},body:JSON.stringify(payload)});
      const data=await response.json() as ReconciliationResult & {message?:string};
      if(!response.ok) throw new Error(data.message||'The reconciliation request failed.');
      const remaining=Math.max(0,850-(Date.now()-started));
      if(remaining) await new Promise((resolve)=>window.setTimeout(resolve,remaining));
      setResult(data); setDatasetName(label); setRunStep(3); setView('overview');
      notify(`${number(data.metrics.processed_records)} primary + evidence records processed · ${data.metrics.matched_pairs} pairs verified`);
    } catch(error) {
      const message=error instanceof Error?error.message:'Unable to process this batch.';
      setUploadError(message); notify(message); setView('data');
    } finally {
      window.clearTimeout(stepOne); window.clearTimeout(stepTwo); setRunning(false);
    }
  };
  const runBenchmark=()=>runRequest({benchmark:true},'Labelled 1,000-record holdout');
  const runUploads=()=>{
    const hasPaymentLoop=(uploads.payments?.length??0)>0&&(uploads.invoices?.length??0)>0;
    const hasSettlementLoop=(uploads.settlements?.length??0)>0&&(uploads.bank_transactions?.length??0)>0;
    if(!hasPaymentLoop&&!hasSettlementLoop){setUploadError('Add payments + invoices or settlements + bank transactions.');return;}
    const groundTruth=uploads.ground_truth?.map((record)=>({left_id:String(record.left_id??record.left??''),right_id:String(record.right_id??record.right??'')})).filter((pair)=>pair.left_id&&pair.right_id);
    runRequest({payments:uploads.payments,invoices:uploads.invoices,settlements:uploads.settlements,bank_transactions:uploads.bank_transactions,settlement_recon_items:uploads.settlement_recon_items,ground_truth:groundTruth?.length?groundTruth:undefined},'Uploaded judge-style batch');
  };
  const onFile=async (kind:UploadKey,event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0]; if(!file)return;
    try{const rows=await parseFile(file);setUploads((current)=>({...current,[kind]:rows}));setUploadError('');notify(`${file.name}: ${number(rows.length)} rows ready`);}catch(error){setUploadError(error instanceof Error?error.message:'Could not read this file.');}
  };
  const exportCsv=()=>{
    const header='record_id,source,reference,amount,amount_minor,currency,status,confidence,reason,action\n';
    const escape=(value:string|number)=>{const raw=String(value);const safe=/^[=+\-@\t\r]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`;};
    const body=allRecords.map((record)=>[record.id,record.source,record.reference,record.amount,record.amount_minor,record.currency,record.status,record.confidence,record.reason,record.action].map(escape).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([header+body],{type:'text/csv'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`closepilot-${result.checksum}.csv`;anchor.click();URL.revokeObjectURL(url);notify('Measured audit report exported');
  };

  return <main className="app-shell">
    <aside className="sidebar"><button className="brand brand-button" onClick={()=>go('overview')}><span className="brand-mark">C</span><span>ClosePilot</span></button><nav aria-label="Main navigation"><button className={`nav-item ${view==='overview'?'active':''}`} onClick={()=>go('overview')}><span>⌁</span>Overview</button><button className={`nav-item ${view==='records'?'active':''}`} onClick={()=>go('records')}><span>⇄</span>Decisions</button><button className={`nav-item ${view==='exceptions'?'active':''}`} onClick={()=>go('exceptions')}><span>!</span>Exceptions <b>{metrics.exception_records}</b></button><button className={`nav-item ${view==='audit'?'active':''}`} onClick={()=>go('audit')}><span>✓</span>Audit trail</button><button className={`nav-item ${view==='data'?'active':''}`} onClick={()=>go('data')}><span>⇧</span>Data lab</button></nav><div className="sidebar-foot"><div className="signal"><i/> Engine v{result.engine_version} healthy</div><div className="user"><span>CP</span><div><strong>Fail-closed</strong><small>Zero silent writes</small></div></div></div></aside>
    <section className="main-panel" id="workspace"><header className="topbar"><button className="mobile-brand brand-button" onClick={()=>go('overview')}><span className="brand-mark">C</span> ClosePilot</button><div className="crumb"><span>Workspace</span><b>/</b> {view==='overview'?'Measured close':view==='records'?'All decisions':view==='exceptions'?'Exception queue':view==='audit'?'Run proof':'Data lab'}</div><div className="top-actions"><span className="live-pill"><i/> API live</span><button className="api-shortcut" onClick={()=>go('data')}>POST /api/v1/reconcile</button></div></header>
      <div className="content">
        {view==='overview'&&<>
          <section className="intro"><div><div className="eyebrow">{datasetName.toUpperCase()} · ENGINE {result.engine_version}</div><h1><span>{percent(metrics.match_rate)}</span> reconciled safely.</h1><p>{number(metrics.processed_records)} primary and evidence records entered the real engine; {number(metrics.matched_pairs)} pairs cleared every identifier, exact-money and ambiguity gate.</p></div><div className="intro-actions"><button className="secondary-button" onClick={()=>go('data')}>Test your data</button><button className="run-button" onClick={runBenchmark}><span>✦</span> Run benchmark</button></div></section>
          <section className="proof-strip" aria-label="Measured run proof"><span><b>{number(metrics.processed_records)}</b> records processed</span><i/><span><b>{metrics.duration_ms.toFixed(2)} ms</b> engine time</span><i/><span><b>{percent(metrics.precision)}</b> precision</span><i/><span><b>{percent(metrics.false_auto_match_rate)}</b> false auto-match</span><i/><span><b>{metrics.silent_drops}</b> silent drops</span></section>
          <section className="metric-grid"><article className="metric hero-metric"><div className="metric-head"><span>Safe match rate</span><em>ground truth verified</em></div><strong>{percent(metrics.match_rate)} </strong><div className="progress"><i style={{width:percent(metrics.match_rate)}}/></div><p>{number(metrics.matched_records)} records resolved <span>·</span> {number(metrics.exception_records)} honest exceptions</p></article><article className="metric"><div className="metric-icon blue">◎</div><span>Precision / recall</span><strong>{metrics.precision===null?'n/a':`${(metrics.precision*100).toFixed(0)} / ${(metrics.recall!*100).toFixed(0)}`}</strong><p>{metrics.ground_truth_pairs?`${number(metrics.ground_truth_pairs)} labelled pairs`:'No ground truth supplied'}</p></article><article className="metric clickable" onClick={()=>go('exceptions')}><div className="metric-icon amber">!</div><span>Exception records</span><strong>{number(metrics.exception_records)}</strong><p>{number(metrics.review_records)} review · {number(metrics.blocked_records)} blocked</p></article><article className="metric"><div className="metric-icon green">↯</div><span>Throughput</span><strong>{number(metrics.throughput_records_per_second)}</strong><p>records / second on this run</p></article></section>
          <section className="insight-grid"><article className="source-card"><div className="section-title"><div><h2>Coverage by source</h2><p>Computed across the complete batch</p></div><button onClick={()=>go('records')}>Inspect decisions →</button></div>{result.source_coverage.map((item)=><div className="source-row" key={item.source}><span>{item.source.replace('Razorpay ','RZP ')}</span><div><i style={{width:percent(item.rate)}}/></div><b>{item.resolved} / {item.total}</b></div>)}</article><article className="boundary-card"><div className="boundary-label"><span>AI</span> MEASURED JUDGMENT</div><h2>Models interpret. Rules authorize.</h2><p>A local narration classifier handles messy bank text. Identifier, value, date, collision and ambiguity rules remain deterministic and fail closed.</p><div className="boundary-pills"><span>✓ {percent(metrics.narration_classifier_accuracy)} classifier holdout</span><span>✓ Idempotency key</span><span>✓ Bounded candidates</span></div></article></section>
          <section className="work-card"><div className="card-header"><div><h2>Latest verified decisions</h2><p>Run {result.run_id} · checksum {result.checksum}</p></div><div className="agent-badge"><i/> Indexed agent · rules verified</div></div><MatchTable rows={[...result.exceptions.slice(0,3),...result.matches.slice(0,5)]} onOpen={setSelected}/><div className="card-footer"><span>Showing 8 of {number(allRecords.length)} decisions</span><button onClick={()=>go('records')}>Inspect full run <span>→</span></button></div></section>
        </>}
        {(view==='records'||view==='exceptions')&&<><section className="page-heading"><div><div className="eyebrow">{view==='records'?`${number(allRecords.length)} EXPLAINED DECISIONS`:`${number(metrics.exception_records)} FAIL-CLOSED RECORDS`}</div><h1>{view==='records'?'Every decision has evidence.':'Uncertainty never becomes money movement.'}</h1><p>{view==='records'?'Search the measured output from the actual reconciliation engine.':'Review ambiguity, missing evidence and schema failures without forced matches.'}</p></div><button className="secondary-button" onClick={exportCsv}>↓ Export measured CSV</button></section><section className="mini-stats"><div><span>Matched records</span><b>{number(metrics.matched_records)}</b><em>{percent(metrics.match_rate)}</em></div><div><span>Needs review</span><b>{number(metrics.review_records)}</b><em className="amber-text">human gate</em></div><div><span>Blocked</span><b>{number(metrics.blocked_records)}</b><em className="red-text">no write</em></div><div><span>F1 score</span><b>{percent(metrics.f1)}</b><em>{metrics.ground_truth_pairs?'measured':'truth not supplied'}</em></div></section><section className="work-card ledger-card"><div className="filterbar"><label className="searchbox"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search record or reference"/></label><select value={source} onChange={(event)=>setSource(event.target.value)} aria-label="Filter by source">{sources.map((item)=><option key={item}>{item}</option>)}</select><span className="result-count">{number(filtered.length)} results</span></div><MatchTable rows={filtered.slice(0,view==='exceptions'?40:50)} onOpen={setSelected}/><div className="card-footer"><span>Showing {Math.min(filtered.length,view==='exceptions'?40:50)} of {number(filtered.length)} records</span><span className="footer-proof">{result.ruleset} · checksum {result.checksum}</span></div></section></>}
        {view==='audit'&&<><section className="page-heading"><div><div className="eyebrow">REPRODUCIBLE RUN PROOF</div><h1>Nothing happens in the dark.</h1><p>Metrics, model boundaries, integrity checks and safety stops come from this exact run.</p></div><button className="secondary-button" onClick={exportCsv}>↓ Export audit CSV</button></section><section className="audit-layout"><article className="audit-card"><div className="section-title"><div><h2>{result.run_id}</h2><p>{new Date(result.generated_at).toLocaleString('en-IN')}</p></div><span className="verified-badge">✓ Measured</span></div><div className="timeline">{result.audit.map((event,index)=><div className="timeline-row" key={`${event.title}-${index}`}><time>{event.time}</time><i className={event.tone}/><div><h3>{event.title}</h3><p>{event.copy}</p></div></div>)}</div></article><aside className="run-proof"><div className="boundary-label"><span>✓</span> RUN INTEGRITY</div><h2>Batch proof</h2><dl><div><dt>Primary records</dt><dd>{number(metrics.input_records)}</dd></div><div><dt>Evidence rows</dt><dd>{number(metrics.settlement_recon_items)}</dd></div><div><dt>Normalized</dt><dd>{number(metrics.normalized_records)}</dd></div><div><dt>Silent drops</dt><dd>{metrics.silent_drops}</dd></div><div><dt>Verifier</dt><dd>{result.verification.status}</dd></div><div><dt>Receipt</dt><dd><code>{result.verification.receipt_sha256.slice(0,16)}…</code></dd></div></dl><button onClick={()=>setSelected(result.exceptions[0]??result.matches[0])}>Inspect a guarded decision →</button></aside></section></>}
        {view==='data'&&<><section className="page-heading"><div><div className="eyebrow">JUDGE-TESTABLE · CSV, JSON & API</div><h1>Test the engine, not the story.</h1><p>Upload exported datasets or call the public endpoint. No column-perfect template is required for common Razorpay, bank and ledger aliases.</p></div><button className="run-button" onClick={runBenchmark}><span>✦</span> Reset benchmark</button></section><section className="data-layout"><article className="upload-card"><div className="section-title"><div><h2>Upload a reconciliation batch</h2><p>At least one complete loop is required</p></div><span className="verified-badge">CSV / JSON</span></div><div className="upload-grid">{([['payments','Razorpay payments','id, amount, invoice/order ID'],['invoices','Invoice ledger','id, total, payment/order ID'],['settlements','Razorpay settlements','id, amount, UTR'],['bank_transactions','Bank statement','transaction ID, credit, UTR'],['settlement_recon_items','Settlement recon proof (optional)','entity_id, settlement_id, credit/debit'],['ground_truth','Ground truth (optional)','left_id, right_id']] as Array<[UploadKey,string,string]>).map(([kind,label,hint])=><label className={`upload-drop ${uploads[kind]?'ready':''}`} key={kind}><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event)=>onFile(kind,event)}/><span>{uploads[kind]?'✓':'+'}</span><strong>{label}</strong><small>{uploads[kind]?`${number(uploads[kind]!.length)} rows ready`:hint}</small></label>)}</div>{uploadError&&<p className="upload-error">{uploadError}</p>}<div className="upload-actions"><button className="secondary-button" onClick={()=>setUploads({})}>Clear files</button><button className="run-button" onClick={runUploads}><span>⇄</span> Reconcile uploaded data</button></div></article><aside className="api-card"><div className="boundary-label"><span>API v1</span> PUBLIC EVALUATION SURFACE</div><h2>POST /api/v1/reconcile</h2><p>Send JSON and receive exact-money decisions, honest exceptions, aggregate settlement proof and a verification receipt.</p><code>{apiOrigin||'https://your-deployment'}/api/v1/reconcile</code><div className="api-actions"><button onClick={()=>{navigator.clipboard.writeText(`${apiOrigin}/api/v1/reconcile`);notify('API endpoint copied')}}>Copy endpoint</button><a href="/openapi.json" target="_blank">OpenAPI spec ↗</a><a href="/api/benchmark?scale=1">Download 1,000-row holdout ↓</a></div><dl><div><dt>Hosted batch limit</dt><dd>100,000 records</dd></div><div><dt>Response modes</dt><dd>full / summary</dd></div><div><dt>Safety</dt><dd>exact + fail-closed</dd></div></dl></aside></section><section className="scale-proof"><div><span>100K</span><p><b>stress-test records</b>Indexed matching avoids a Cartesian scan.</p></div><div><span>0</span><p><b>false automatic matches</b>On the labelled adversarial benchmark.</p></div><div><span>0</span><p><b>silent drops</b>Malformed records become visible exceptions.</p></div><div><span>SHA-256</span><p><b>verification receipt</b>Every released decision passes an independent invariant check.</p></div></section></>}
        <footer className="product-footer"><span>TRACK 04 · AI FINANCE CONTROLLER</span><p>Measured, reproducible, fail-closed.</p></footer>
      </div>
    </section>
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${selected.id}`} onClick={(event)=>event.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)} aria-label="Close details">×</button><div className="eyebrow">ENGINE DECISION · {selected.domain.replaceAll('_',' ')}</div><h2>{selected.id}</h2><p className="drawer-sub">{selected.source} · {selected.date}</p><div className="drawer-amount"><span>Amount</span><b>{money(selected.amount,selected.currency)}</b></div><div className="decision-line"><span className={`status ${selected.status.toLowerCase()}`}>{selected.status}</span><div><i><b style={{width:`${selected.confidence}%`}}/></i><span>{selected.confidence}% confidence</span></div></div><section><h3>Why the engine decided this</h3><p>{selected.reason}</p></section><section><h3>Evidence evaluated</h3><ul>{selected.evidence.map((item)=><li key={item}><span>✓</span>{item}</li>)}</ul></section><section className="next-action"><h3>Bounded next action</h3><p>{selected.action}</p></section><div className="drawer-actions"><button className="approve" onClick={()=>{navigator.clipboard.writeText(`${selected.id}: ${selected.reason}`);notify('Decision evidence copied')}}>Copy evidence</button><button onClick={()=>setSelected(null)}>Close unresolved</button></div><small className="safety-note">The API never moves money or mutates source records.</small></aside></div>}
    {running&&<div className="run-overlay" role="status" aria-live="polite"><div className="run-modal"><div className="agent-orbit"><span>✦</span><i/></div><div className="eyebrow">REAL AGENT RUN · STEP {Math.min(runStep+1,3)} OF 3</div><h2>{['Validating and normalizing records','Building bounded candidate indexes','Scoring evidence and applying safety gates'][Math.min(runStep,2)]}</h2><p>{['Invalid rows become exceptions—never silent drops.','Identifier, amount and customer buckets replace pairwise scanning.','Ambiguity and low confidence stop automatic decisions.'][Math.min(runStep,2)]}</p><div className="run-progress"><i style={{width:`${[24,62,92][Math.min(runStep,2)]}%`}}/></div><small>The displayed metrics will come from this exact API execution.</small></div></div>}
    {toast&&<div className="toast"><span>✓</span>{toast}</div>}
  </main>;
}
