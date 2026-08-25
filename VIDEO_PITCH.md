# ClosePilot — final Orion five-minute pitch

Record with the scored Orion result already open at `https://closepilot-finance.vercel.app`. Keep a terminal ready at the project root. Text in square brackets is an on-screen action and should not be spoken.

## 0:00–0:25 — The problem

[Show the Orion Overview headline.]

Hi, I’m Souvik, and this is ClosePilot for Track 04, AI Finance Controller.

Finance teams do not need another AI that finds one attractive match. They need a controller that closes the entire payment-to-cash loop, explains every decision, and refuses to turn uncertainty into money movement.

ClosePilot follows one rule: models interpret, deterministic rules authorize, and uncertainty fails closed.

## 0:25–1:05 — The Orion challenge

[Point to the 62,500-row accounting and ground-truth badge.]

I built the independent Orion stress pack so the demo could not hide behind a cherry-picked row. It contains six CSV files, each above 10,000 rows: 12,500 payments, invoices, settlements, bank transactions and settlement-proof rows, plus 22,000 ground-truth pairs.

The financial denominator is 50,000 primary records. Another 12,500 recon rows prove aggregate settlement closure. Ground-truth labels measure the result but never inflate coverage.

This closes two linked stages: payment to invoice, and settlement through aggregate recon proof to the bank credit.

## 1:05–1:50 — Results that close mathematically

[Point to safe-match rate, accuracy, exceptions and Denominator proof.]

ClosePilot released 22,000 one-to-one pairs, resolving 44,000 primary endpoints. It returned every other record explicitly: 1,000 ambiguous records for human review and 5,000 blocked. So 50,000 inputs equal 44,000 matched plus 6,000 exceptions, giving 88 percent safe resolution with zero silent drops.

Against Orion’s 22,000 labels, precision, recall and F1 are 100 percent, with zero false automatic matches. This is a result on a generated adversarial dataset, not a universal accuracy claim.

All 12,500 settlement closures passed aggregate proof. A one-subunit error would block release rather than disappear inside rounding.

## 1:50–2:35 — Reproduce the real engine

[In the terminal run `node --experimental-strip-types ".\artifact-work\orion-stress\verify-orion.mjs"`.]

This command loads the committed Orion request and calls the same reconciliation engine used by the public API. The committed development-machine run processed 62,500 primary-plus-proof rows in 5.08 seconds, about 12,308 rows per second. Its complete wrapper, including loading and independent verification, finished in 8.08 seconds. This live timing may vary by hardware.

[Show `PASS`, 22,000 checked matches and the SHA-256 receipt.]

The verifier independently re-reads the canonical facts, proves one-to-one use, checks thresholds, closes all 12,500 settlements and signs the run. A failed invariant aborts the result.

## 2:35–3:25 — Why the agent is safe

[Open Decisions, inspect one matched settlement, then show an ambiguous Review record.]

ClosePilot is agentic, but bounded. It normalizes common Razorpay, ledger and bank aliases, represents money as integer minor units, builds indexed candidate sets, scores evidence, applies safety gates, routes exceptions and verifies its own output.

For messy bank narration, a local Naive Bayes classifier may identify settlement intent, but it contributes at most three points. It cannot release money. Exact UTR contributes 70 points, exact net amount 25, and the settlement window up to 10. Release requires at least 85 points, exact money and a 10-point lead over the runner-up.

A debit, currency mismatch, merchant mismatch, non-exact value or ambiguity fails closed. That is why the 1,000 ambiguous Orion records remain Review even when their top candidate scores 89.

## 3:25–4:15 — The 2 AM failure

[Show the throughput card, then Audit trail.]

At 2 AM, the dashboard produced a spectacular throughput number. It was wrong.

The engine completed inside one coarse tick of the hosted edge clock, collapsing elapsed time to zero. I also found that a blind run could visually resemble a ground-truth-scored run. In finance, impressive but false evidence is a correctness failure.

I reproduced the discrepancy using a monotonic local benchmark and a browser-observed public round trip. The fix was nullable server timing when the clock is untrustworthy, explicit measurement sources, separate blind and scored states, and visible denominator accounting.

That is why this browser card reports end-to-end public throughput while the terminal reports engine throughput. ClosePilot refuses to invent performance evidence for the same reason it refuses to invent a match.

## 4:15–4:40 — Judge-testable delivery

[Show Data lab, API indicator, OpenAPI link and GitHub link.]

Judges can upload their own CSV or JSON, call the public versioned API, or run Orion locally. Without labels, accuracy remains null. With labels, it is measured. The public summary endpoint accepts up to 100,000 financial records, and every response includes exceptions, audit evidence and a verification receipt.

The repository also has 21 tests covering ambiguity, duplicate IDs, void invoices, bank debits, merchant and currency boundaries, malformed money and one-subunit proof tampering.

## 4:40–5:00 — Close

[Return to the Orion Overview.]

Track 04 asks for throughput, measured accuracy and an honest exception list. ClosePilot demonstrates all three on 62,500 financial and proof rows, through a public API and reproducible source.

AI increases verification capacity. Deterministic evidence keeps financial authority bounded.

That is ClosePilot. Thank you.
