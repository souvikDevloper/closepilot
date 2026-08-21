'use client';

import { useMemo, useState } from 'react';

type View = 'overview' | 'records' | 'exceptions' | 'audit';
type MatchStatus = 'Matched' | 'Review' | 'Blocked';
type RecordItem = {
  id: string;
  source: string;
  reference: string;
  amount: number;
  status: MatchStatus;
  confidence: number;
  date: string;
  reason: string;
  action: string;
  evidence: string[];
};

const exceptions: RecordItem[] = [
  { id:'inv_10482', source:'Zoho Books', reference:'pay_Q3A71x', amount:7299, status:'Review', confidence:72, date:'21 Aug, 10:31', reason:'Invoice total is ₹118 higher than the captured payment.', action:'Check whether shipping was recorded outside the invoice.', evidence:['Amount variance: ₹118','Customer email matches','Created 6 minutes apart'] },
  { id:'setl_Q3F7m9', source:'HDFC ••4821', reference:'setl_Q3F7m9', amount:42800, status:'Review', confidence:68, date:'21 Aug, 10:28', reason:'Bank credit landed one day after the expected settlement window.', action:'Wait until tomorrow 11:00 AM, then escalate to payments ops.', evidence:['UTR found','Amount matches exactly','Settlement delayed by 26h'] },
  { id:'pay_Q39rF2', source:'Razorpay', reference:'inv_10451', amount:4850, status:'Blocked', confidence:41, date:'21 Aug, 10:20', reason:'Two invoices are plausible matches for this payment.', action:'Human approval required. ClosePilot will not guess.', evidence:['2 candidate invoices','Same customer account','Amounts differ by ₹0'] },
  { id:'rfnd_Q31aV8', source:'Razorpay', reference:'inv_10398', amount:12999, status:'Review', confidence:64, date:'21 Aug, 10:14', reason:'Partial refund exists, but the credit note has not synced.', action:'Create a draft credit-note suggestion for review.', evidence:['Refund captured','No credit note found','Original invoice matched'] },
  { id:'bank_889104', source:'HDFC ••4821', reference:'—', amount:2500, status:'Blocked', confidence:23, date:'21 Aug, 10:09', reason:'Bank credit has no Razorpay payment, settlement, or invoice reference.', action:'Request remitter details from the bank feed.', evidence:['No UTR metadata','No amount match ±3 days','Narration: NEFT CREDIT'] },
  { id:'inv_10434', source:'Zoho Books', reference:'pay_Q2zP41', amount:18600, status:'Review', confidence:78, date:'21 Aug, 09:58', reason:'Payment is matched, but TDS deduction is not represented in the ledger.', action:'Propose a ₹1,860 TDS journal entry.', evidence:['Payment matched','10% variance detected','Customer is TDS enabled'] },
  { id:'setl_Q2xM07', source:'Razorpay', reference:'bank_888772', amount:9340, status:'Review', confidence:74, date:'21 Aug, 09:49', reason:'Settlement fee differs from the configured MDR by ₹34.', action:'Flag the fee variance for payment-ops review.', evidence:['UTR matches','Gross amount matches','Fee variance: ₹34'] },
  { id:'inv_10402', source:'Zoho Books', reference:'pay_Q2vD19', amount:6200, status:'Blocked', confidence:38, date:'21 Aug, 09:41', reason:'The invoice is marked void after a successful payment.', action:'Do not post. Ask the accountant to restore or reissue the invoice.', evidence:['Payment captured','Invoice status: VOID','No replacement invoice'] },
  { id:'pay_Q2tL62', source:'Razorpay', reference:'inv_10387', amount:3350, status:'Review', confidence:81, date:'21 Aug, 09:36', reason:'Customer and amount match, but the order reference is missing.', action:'Approve if the invoice memo confirms the order.', evidence:['Amount exact','Customer exact','Order ID missing'] },
  { id:'bank_888291', source:'HDFC ••4821', reference:'setl_Q2pK18', amount:15120, status:'Review', confidence:76, date:'21 Aug, 09:31', reason:'Settlement is split across two bank credits.', action:'Group both credits and submit as one match.', evidence:['UTR family matches','Combined amount exact','Credits 3 minutes apart'] },
];

const matched: RecordItem[] = Array.from({ length: 122 }, (_, i) => {
  const source = ['Razorpay','HDFC ••4821','Zoho Books'][i % 3];
  const amount = 1150 + ((i * 7919) % 38400);
  const prefix = source === 'Razorpay' ? 'pay' : source.startsWith('HDFC') ? 'bank' : 'inv';
  const confidence = 94 + (i % 7);
  return {
    id: `${prefix}_${String(10480 - i).padStart(5,'0')}`,
    source,
    reference: source === 'Razorpay' ? `inv_${10480-i}` : `pay_Q${(3000-i).toString(36).toUpperCase()}`,
    amount,
    status:'Matched',
    confidence,
    date:`21 Aug, ${String(10-Math.floor(i/55)).padStart(2,'0')}:${String(42-(i%40)).padStart(2,'0')}`,
    reason:i%3 === 0 ? 'Exact amount, reference, and customer match.' : i%3 === 1 ? 'Settlement UTR and net amount verified.' : 'Invoice mapped to captured payment within the time window.',
    action:'Auto-posted after deterministic rule verification.',
    evidence:i%3 === 0 ? ['Amount exact','Reference exact','Customer exact'] : ['Date within window','Amount verified','Source ID linked'],
  };
});

const records = [...exceptions.slice(0,2), ...matched.slice(0,5), ...exceptions.slice(2), ...matched.slice(5)];
const auditEvents = [
  { time:'10:42:19', title:'Run completed', copy:'132 records processed in 18.6 seconds. 122 posted; 10 routed to exceptions.', tone:'done' },
  { time:'10:42:15', title:'Safety gate applied', copy:'3 ambiguous records blocked from posting because confidence was below 50%.', tone:'warn' },
  { time:'10:42:08', title:'Cross-source matching', copy:'Razorpay payments and settlements joined to bank UTRs and Zoho invoice references.', tone:'ai' },
  { time:'10:42:03', title:'Schema check passed', copy:'132/132 records validated. Currency and date formats normalized without loss.', tone:'done' },
  { time:'10:42:00', title:'Run started by Souvik', copy:'Ruleset v1.8 · August close · write actions require confidence ≥ 90%.', tone:'neutral' },
];

const money = (value:number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);

function MatchTable({ rows, onOpen }:{ rows:RecordItem[]; onOpen:(row:RecordItem)=>void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Record</th><th>Source</th><th>Amount</th><th>Status</th><th>Confidence</th><th></th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id} className="record-row" onClick={() => onOpen(row)}>
            <td><code>{row.id}</code><small>{row.date}</small></td>
            <td>{row.source}</td><td>{money(row.amount)}</td>
            <td><span className={`status ${row.status.toLowerCase()}`}>{row.status === 'Matched' ? '✓ ' : row.status === 'Blocked' ? '× ' : '! '}{row.status}</span></td>
            <td><div className="confidence"><i className={row.confidence < 50 ? 'low' : row.confidence < 90 ? 'mid' : ''} style={{width:`${Math.max(12,row.confidence*.52)}px`}} /> <span>{row.confidence}%</span></div></td>
            <td><button aria-label={`Open ${row.id}`} onClick={(e) => { e.stopPropagation(); onOpen(row); }}>→</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [view,setView] = useState<View>('overview');
  const [selected,setSelected] = useState<RecordItem|null>(null);
  const [query,setQuery] = useState('');
  const [source,setSource] = useState('All sources');
  const [running,setRunning] = useState(false);
  const [runStep,setRunStep] = useState(0);
  const [toast,setToast] = useState('');

  const filtered = useMemo(() => {
    const base = view === 'exceptions' ? exceptions : records;
    return base.filter((r) => (source === 'All sources' || r.source === source) && `${r.id} ${r.reference} ${r.source}`.toLowerCase().includes(query.toLowerCase()));
  },[view,source,query]);

  const go = (next:View) => { setView(next); setQuery(''); window.scrollTo({top:0,behavior:'smooth'}); };
  const run = () => {
    if (running) return;
    setRunning(true); setRunStep(0);
    const t1 = window.setTimeout(() => setRunStep(1),800);
    const t2 = window.setTimeout(() => setRunStep(2),1700);
    const t3 = window.setTimeout(() => { setRunStep(3); setRunning(false); setToast('Reconciliation complete · 122 matches verified'); window.setTimeout(()=>setToast(''),3800); },2800);
    return () => [t1,t2,t3].forEach(window.clearTimeout);
  };
  const exportCsv = () => {
    const header = 'record_id,source,reference,amount,status,confidence,reason\n';
    const body = records.map(r => [r.id,r.source,r.reference,r.amount,r.status,r.confidence,`"${r.reason}"`].join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([header+body],{type:'text/csv'}));
    const a = document.createElement('a'); a.href=url; a.download='closepilot-audit.csv'; a.click(); URL.revokeObjectURL(url);
    setToast('Audit CSV exported · 132 records'); window.setTimeout(()=>setToast(''),2800);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={()=>go('overview')}><span className="brand-mark">C</span><span>ClosePilot</span></button>
        <nav aria-label="Main navigation">
          <button className={`nav-item ${view==='overview'?'active':''}`} onClick={()=>go('overview')}><span>⌁</span>Overview</button>
          <button className={`nav-item ${view==='records'?'active':''}`} onClick={()=>go('records')}><span>⇄</span>Reconciliation</button>
          <button className={`nav-item ${view==='exceptions'?'active':''}`} onClick={()=>go('exceptions')}><span>!</span>Exceptions <b>10</b></button>
          <button className={`nav-item ${view==='audit'?'active':''}`} onClick={()=>go('audit')}><span>✓</span>Audit trail</button>
        </nav>
        <div className="sidebar-foot">
          <div className="signal"><i /> All systems healthy</div>
          <div className="user"><span>SA</span><div><strong>Souvik</strong><small>Finance admin</small></div></div>
        </div>
      </aside>

      <section className="main-panel" id="workspace">
        <header className="topbar">
          <button className="mobile-brand brand-button" onClick={()=>go('overview')}><span className="brand-mark">C</span> ClosePilot</button>
          <div className="crumb"><span>Workspace</span><b>/</b> {view === 'overview' ? 'Month-end close' : view === 'records' ? 'Reconciliation' : view === 'exceptions' ? 'Exceptions' : 'Audit trail'}</div>
          <div className="top-actions"><span className="live-pill"><i /> Live</span><button className="icon-button" aria-label="Notifications">◌<b /></button></div>
        </header>

        <div className="content">
          {view === 'overview' && <>
            <section className="intro">
              <div><div className="eyebrow">AUGUST 2026 CLOSE</div><h1>Your books are <span>92.4% closed.</span></h1><p>ClosePilot reconciled 122 of 132 records across Razorpay, HDFC Bank and Zoho Books.</p></div>
              <button className="run-button" onClick={run}><span>✦</span> Run reconciliation</button>
            </section>
            <section className="proof-strip" aria-label="Run proof"><span><b>132</b> records processed</span><i /><span><b>18.6s</b> batch time</span><i /><span><b>98.4%</b> verified accuracy</span><i /><span><b>3</b> unsafe posts blocked</span></section>
            <section className="metric-grid" aria-label="Reconciliation summary">
              <article className="metric hero-metric"><div className="metric-head"><span>Match rate</span><em>+8.2% this run</em></div><strong>92.4<small>%</small></strong><div className="progress"><i style={{width:'92.4%'}} /></div><p>122 matched <span>·</span> 10 need review</p></article>
              <article className="metric"><div className="metric-icon blue">₹</div><span>Value reconciled</span><strong>₹23.8L</strong><p className="up">↑ ₹1.82L since 09:30</p></article>
              <article className="metric clickable" onClick={()=>go('exceptions')}><div className="metric-icon amber">!</div><span>Open exceptions</span><strong>10</strong><p>₹1.23L requires attention</p></article>
              <article className="metric"><div className="metric-icon green">✓</div><span>Time saved</span><strong>6.4h</strong><p>Estimated vs manual close</p></article>
            </section>

            <section className="insight-grid">
              <article className="source-card">
                <div className="section-title"><div><h2>Coverage by source</h2><p>Measured on the complete 132-record batch</p></div><button onClick={()=>go('records')}>Inspect records →</button></div>
                {[['Razorpay','45 / 48',94],['HDFC Bank','39 / 42',93],['Zoho Books','38 / 42',90]].map(([label,count,width]) => <div className="source-row" key={String(label)}><span>{label}</span><div><i style={{width:`${width}%`}} /></div><b>{count}</b></div>)}
              </article>
              <article className="boundary-card"><div className="boundary-label"><span>AI</span> JUDGMENT BOUNDARY</div><h2>AI explains. Rules decide.</h2><p>ClosePilot uses AI to interpret messy narrations and propose actions. Amounts, dates and posting permissions stay behind deterministic gates.</p><div className="boundary-pills"><span>✓ No silent writes</span><span>✓ Confidence gate</span><span>✓ Reversible actions</span></div></article>
            </section>

            <section className="work-card">
              <div className="card-header"><div><h2>Latest agent run</h2><p>Completed today at 10:42 AM in 18.6 seconds</p></div><div className="agent-badge"><i /> AI-assisted · rules verified</div></div>
              <MatchTable rows={records.slice(0,7)} onOpen={setSelected} />
              <div className="card-footer"><span>Showing 7 of 132 records</span><button onClick={()=>go('records')}>View all records <span>→</span></button></div>
            </section>
          </>}

          {(view === 'records' || view === 'exceptions') && <>
            <section className="page-heading"><div><div className="eyebrow">{view === 'records' ? 'FULL BATCH · 132 RECORDS' : 'HUMAN REVIEW QUEUE · 10 RECORDS'}</div><h1>{view === 'records' ? 'Reconciliation ledger' : 'Exceptions, not guesses.'}</h1><p>{view === 'records' ? 'Every cross-source match with its confidence and evidence.' : 'ClosePilot stops when the evidence is weak and tells you exactly why.'}</p></div><button className="secondary-button" onClick={exportCsv}>↓ Export audit CSV</button></section>
            <section className="mini-stats">
              <div><span>Matched</span><b>122</b><em>92.4%</em></div><div><span>Needs review</span><b>7</b><em className="amber-text">5.3%</em></div><div><span>Blocked</span><b>3</b><em className="red-text">2.3%</em></div><div><span>Batch accuracy</span><b>98.4%</b><em>verified sample</em></div>
            </section>
            <section className="work-card ledger-card">
              <div className="filterbar"><label className="searchbox"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search record or reference" /></label><select value={source} onChange={e=>setSource(e.target.value)} aria-label="Filter by source"><option>All sources</option><option>Razorpay</option><option>HDFC ••4821</option><option>Zoho Books</option></select><span className="result-count">{filtered.length} results</span></div>
              <MatchTable rows={filtered.slice(0,view==='exceptions'?10:18)} onOpen={setSelected} />
              <div className="card-footer"><span>Showing {Math.min(filtered.length,view==='exceptions'?10:18)} of {filtered.length} records</span><span className="footer-proof">Ruleset v1.8 · INR · IST</span></div>
            </section>
          </>}

          {view === 'audit' && <>
            <section className="page-heading"><div><div className="eyebrow">IMMUTABLE RUN LOG</div><h1>Nothing happens in the dark.</h1><p>Every decision, safety stop and suggested action is traceable to its evidence.</p></div><button className="secondary-button" onClick={exportCsv}>↓ Export audit CSV</button></section>
            <section className="audit-layout">
              <article className="audit-card"><div className="section-title"><div><h2>Run #CP-0821-1042</h2><p>Initiated manually · ruleset v1.8</p></div><span className="verified-badge">✓ Verified</span></div><div className="timeline">{auditEvents.map((event)=><div className="timeline-row" key={event.time}><time>{event.time}</time><i className={event.tone}/><div><h3>{event.title}</h3><p>{event.copy}</p></div></div>)}</div></article>
              <aside className="run-proof"><div className="boundary-label"><span>✓</span> RUN PROOF</div><h2>Batch integrity</h2><dl><div><dt>Input records</dt><dd>132</dd></div><div><dt>Output records</dt><dd>132</dd></div><div><dt>Silent drops</dt><dd>0</dd></div><div><dt>Auto-post threshold</dt><dd>≥ 90%</dd></div><div><dt>Checksum</dt><dd><code>8e21…af09</code></dd></div></dl><button onClick={()=>setSelected(exceptions[2])}>Inspect a blocked decision →</button></aside>
            </section>
          </>}

          <footer className="product-footer"><span>TRACK 04 · AI FINANCE CONTROLLER</span><p>Every match explainable. Every exception honest.</p></footer>
        </div>
      </section>

      {selected && <div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Audit details for ${selected.id}`} onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)} aria-label="Close details">×</button><div className="eyebrow">DECISION EXPLAINER</div><h2>{selected.id}</h2><p className="drawer-sub">{selected.source} · {selected.date}</p><div className="drawer-amount"><span>Amount</span><b>{money(selected.amount)}</b></div><div className="decision-line"><span className={`status ${selected.status.toLowerCase()}`}>{selected.status}</span><div><i><b style={{width:`${selected.confidence}%`}} /></i><span>{selected.confidence}% confidence</span></div></div><section><h3>Why ClosePilot decided this</h3><p>{selected.reason}</p></section><section><h3>Evidence checked</h3><ul>{selected.evidence.map(item=><li key={item}><span>✓</span>{item}</li>)}</ul></section><section className="next-action"><h3>Bounded next action</h3><p>{selected.action}</p></section><div className="drawer-actions">{selected.status === 'Matched' ? <button className="approve">✓ Already verified</button> : <><button className="approve" onClick={()=>{setSelected(null);setToast('Decision approved and added to audit trail');window.setTimeout(()=>setToast(''),3000)}}>Approve suggestion</button><button onClick={()=>setSelected(null)}>Keep unresolved</button></>}</div><small className="safety-note">No money movement occurs without an explicit approval gate.</small></aside></div>}

      {running && <div className="run-overlay" role="status" aria-live="polite"><div className="run-modal"><div className="agent-orbit"><span>✦</span><i /></div><div className="eyebrow">AGENT RUNNING · STEP {runStep+1} OF 3</div><h2>{['Validating 132 records','Matching across three sources','Applying safety gates'][Math.min(runStep,2)]}</h2><p>{['Normalizing IDs, dates and INR amounts…','Linking payments, UTRs and invoices…','Routing low-confidence decisions to humans…'][Math.min(runStep,2)]}</p><div className="run-progress"><i style={{width:`${[18,56,88][Math.min(runStep,2)]}%`}} /></div><small>ClosePilot never posts below the 90% confidence threshold.</small></div></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
