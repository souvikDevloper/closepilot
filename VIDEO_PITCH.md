# ClosePilot — five-minute pitch

Use the public app at `https://closepilot-finance.vercel.app`. Keep the camera bubble small, zoom the browser to show the full dashboard, and keep a terminal ready in the repository.

## 0:00–0:35 — Problem and promise

Hi, I’m Souvik, and this is ClosePilot for Track 04, AI Finance Controller.

Finance teams still reconcile Razorpay payments, invoices, settlements and bank credits across separate exports. The dangerous part is not finding one obvious match. It is closing a complete batch without silently forcing uncertain records.

ClosePilot is a bounded reconciliation agent that follows one rule: models interpret, deterministic rules authorize, and uncertainty fails closed.

## 0:35–1:15 — State the measured result

[Show Overview. Point to the headline, exceptions and throughput cards.]

This labelled holdout contains 1,000 primary records. ClosePilot safely resolves 960, or 96 percent, and exposes the remaining 40 as honest exceptions: 10 for human review and 30 blocked.

The 480 pair count is not another denominator. Each pair resolves two records, so 480 pairs equal 960 matched endpoints. The additional 325 settlement rows are proof evidence and never inflate match rate.

On this holdout, measured precision and recall are both 100 percent, false automatic matches are zero, and silent drops are zero. The documented 132,500-row stress run processed about 12,421 primary-plus-evidence records per second on the development machine.

## 1:15–2:05 — Live demo

[Open Data lab and click Run benchmark.]

This is not a static dashboard. The button calls the same public `POST /api/v1/reconcile` endpoint that judges can call or test with their own CSV and JSON files.

[Open Decisions, then an evidence drawer.]

Every released pair contains its exact amount in minor units, confidence, evidence and next action.

[Open Exceptions.]

Ambiguous candidates go to review. Missing identifiers, malformed amounts, duplicates and unsupported candidates remain blocked. The API never moves money or mutates source systems.

## 2:05–3:05 — Architecture

[Open Architecture. Move left to right across the flow.]

The execution is a bounded autonomous state machine. First, schema guards normalize common Razorpay, bank and ledger aliases into an exact canonical ledger using integer minor units.

Second, hash indexes generate bounded candidates by identifiers, UTR, order, customer and amount. There is no Cartesian product scan.

A local narration classifier interprets messy bank text, but its output is evidence only. Currency, merchant, direction, exact value, collisions, confidence and ambiguity remain deterministic authority.

For settlement evidence, ClosePilot proves that aggregate credits minus debits equal the settlement amount. A one-subunit difference prevents release.

Finally, an independent verifier re-reads canonical facts, checks one-to-one use and decision accounting, and signs the run with a SHA-256 receipt. Any failed invariant aborts the result.

## 3:05–3:55 — Adversarial evidence and reproducibility

[Show Audit trail, then terminal. Run `npm run eval:holdout`.]

The repository includes a one-command evaluation path and 21 adversarial tests covering ambiguity, duplicate IDs, void invoices, bank debits, merchant and currency boundaries, malformed money, duplicate settlement evidence and one-subunit proof tampering.

Ground truth is optional. Without labels, accuracy fields are null instead of invented. With labels, precision, recall, F1 and false-auto-match rate are measured. Judges can also use the public OpenAPI contract and a hosted summary mode for batches up to 100,000 records.

## 3:55–4:35 — What broke and how it was fixed

[Return to Architecture and point to the failure panel.]

The most important failure was false precision. The hosted edge clock froze during execution and originally implied an impossible throughput number. A blind run could also visually look ground-truth verified.

I treated both as correctness bugs. Timing is now nullable when the host clock is unreliable; the dashboard labels either the reproducible local benchmark or browser-observed end-to-end timing. Blind and scored states are separate, match-rate denominators are explicit, and regression tests replay both states on the independent Nova evaluation pack.

## 4:35–5:00 — Close

[Show Overview, public GitHub link and API-live indicator.]

ClosePilot exceeds the Track 04 minimum with multi-source batches, measured throughput, measured accuracy, an honest exception queue, an independent verifier, public source and a judge-testable API.

It does not claim that AI should control money. It demonstrates the safer idea: AI can increase verification capacity while deterministic evidence keeps financial authority bounded.

That is ClosePilot. Thank you.
