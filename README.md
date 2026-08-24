# ClosePilot

ClosePilot is a bounded, fail-closed reconciliation agent for Razorpay payments, settlement recon items, settlements, bank transactions and invoice ledgers. It turns exported CSV/JSON into explainable matches, aggregate cash-closure proofs, an honest exception queue and reproducible verification receipts.

## Live evaluator deployment

- Public repository: https://github.com/souvikDevloper/closepilot
- App: https://closepilot-finance.vercel.app
- Evaluation API: https://closepilot-finance.vercel.app/api/v1/reconcile
- OpenAPI 3.1: https://closepilot-finance.vercel.app/openapi.json
- Health check: https://closepilot-finance.vercel.app/api/health

## Track 04 proof at a glance

| Required proof | ClosePilot evidence |
| --- | --- |
| One closed finance-ops loop | Payments are reconciled to invoices; aggregate settlement proof is reconciled to settlement totals; settlement credits are reconciled to bank transactions. |
| A batch larger than 50 records | The labelled judge path contains 1,000 primary records. The committed scale run contains 100,000 primary records plus 32,500 proof rows. |
| Measured accuracy | The labelled holdout reports 100% precision and recall, with the denominator and pair/end-point arithmetic shown below. Unlabelled runs report accuracy as `null`. |
| Measured throughput | The reproducible 132,500-row development-machine run processes about 12,400 primary-plus-evidence rows per second. Runtime provenance is always labelled. |
| Honest exceptions | The 1,000-record holdout resolves 960 endpoints and returns 40 exceptions: 10 review and 30 blocked. |
| Judge-testable delivery | Public source, a one-command local evaluation, downloadable holdout data, OpenAPI 3.1 and a public versioned API are all available above. |

## What is real

- The UI calls the same versioned `POST /api/v1/reconcile` endpoint available to evaluators.
- All dashboard metrics are calculated by the engine for the displayed batch.
- Money is parsed and summed as exact integer minor units; floating-point values never authorize a decision.
- Razorpay settlement credits and debits are aggregated by settlement and must close exactly before bank matching is released.
- Candidate generation uses bounded indexes instead of a Cartesian scan.
- Currency, merchant scope, bank direction, duplicate IDs, void invoices, confidence and ambiguity are hard safety gates.
- A local Naive Bayes model classifies messy bank narrations. It can provide evidence but cannot authorize a financial decision.
- A structurally independent second pass verifies match facts, one-to-one use, settlement proof, decision accounting and release thresholds, then emits a SHA-256 receipt.
- The API does not move money or modify source systems.

## Models interpret; rules authorize

The narration model is deliberately small, local and inspectable. It tokenizes bank text and uses Laplace-smoothed multinomial Naive Bayes to classify six intents: settlement, refund, TDS, fee, payout and unknown. Its isolated 12-phrase holdout is reported separately from reconciliation accuracy, so classifier performance cannot be confused with financial-decision precision.

For settlement-to-bank matching, model output is worth only **3 evidence points** and is counted only when `settlement` confidence is at least 45%. Deterministic evidence carries authority:

- exact UTR: +70
- settlement reference in the bank feed: +55
- exact net amount in integer minor units: +25
- settlement-window evidence: up to +10
- narration model: at most +3

Automatic release requires at least 85 points, an exact amount, a 10-point lead over the runner-up, and every hard gate to pass. Currency mismatch, merchant-scope mismatch or a bank debit hard-rejects the candidate. Tolerated amount differences can be reviewed but can never be auto-released. Callers may tighten these limits, but the API rejects attempts to weaken the 85-point release threshold or 10-point ambiguity margin.

Illustrative decision trace:

```text
Bank text:   "RZP merchant settlement UTR-AX91 credited"
Model:       settlement -> up to +3 evidence points
Rules:       exact UTR +70; exact net amount +25; date window up to +10
Authority:   release only if hard gates, threshold and ambiguity checks pass
Countercase: the same text with a debit, wrong currency, wrong merchant or
             non-exact amount is rejected or routed to review
```

The model therefore helps interpret an unstructured field but cannot manufacture identity, repair money or overrule a safety boundary.

## Reproducible benchmark

```bash
npm ci
npm test
npm run eval:holdout
npm run benchmark -- 100
```

`npm run eval:holdout` is the one-command judge path. It produces 1,000 primary records plus 325 Razorpay settlement evidence rows: 480 labelled pairs and 40 deliberately ambiguous or unmatched primary records. The arithmetic is `1,000 primary = 960 matched endpoints + 40 exceptions`; the 480 pair decisions each resolve two endpoints, and the 325 evidence rows are excluded from the match-rate denominator.

The automated suite also processes a 10,000-primary-record variant and verifies exact money, deterministic receipts, aggregate settlement proof, one-subunit tampering, ambiguity, malformed inputs, duplicate evidence, cross-currency candidates, cross-merchant candidates and bank debits.

Latest local run with 100,000 primary records plus 32,500 settlement evidence rows on the development machine:

- 48,000 matched pairs
- 4,000 honest exception records
- 100% precision and recall on the generated labelled holdout
- 0 false automatic matches
- 0 silent drops
- ~12,400 primary + evidence records/second

Performance is hardware-dependent. These figures describe the committed synthetic benchmark, not an unsupported claim about all external data.

The dashboard preserves that distinction. If the edge runtime cannot provide a trustworthy monotonic duration, the API returns `null`; the UI then shows the documented local benchmark, or a browser-observed end-to-end rate after an interactive run, with the measurement source labelled.

## Public evaluation API

```bash
curl -X POST https://closepilot-finance.vercel.app/api/v1/reconcile \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evaluator-run-001" \
  -d @examples/request.json
```

Useful endpoints:

- `GET /api/v1/reconcile` — contract, limits and example
- `POST /api/v1/reconcile` — execute a batch
- `POST /api/reconcile` — deprecated compatibility alias
- `GET /api/benchmark?scale=1` — download the labelled 1,000-record holdout
- `GET /openapi.json` — OpenAPI description
- `GET /api/health` — health and engine version

The hosted API accepts up to 100,000 records in `summary` mode. Full decision responses are capped at 20,000 records to keep response size bounded. Larger production workloads should be sharded by merchant, currency and settlement date.

## Request contract

```json
{
  "payments": [],
  "invoices": [],
  "settlements": [],
  "bank_transactions": [],
  "settlement_recon_items": [],
  "ground_truth": [{ "left_id": "pay_001", "right_id": "inv_001" }],
  "response_mode": "full"
}
```

Ground truth is optional. When supplied, the response calculates precision, recall, F1 and false-auto-match rate. Without it, those metrics are returned as `null` instead of being invented.

The response exposes two deliberately different coverage denominators: `input_resolution_rate` is matched endpoints divided by every submitted primary record (including validation rejects), while the backward-compatible `match_rate` is matched endpoints divided by successfully normalized records. Runtime and throughput are `null` when the host's monotonic clock is too coarse to support an honest measurement.

`settlement_recon_items` accepts Razorpay settlement recon rows. `credit`, `debit`, `fee` and `tax` are integer currency subunits. Fees and tax are evidence fields; the authoritative settlement net is `sum(credit - debit)`, so they are not subtracted twice.

For multi-currency batches, `value_reconciled` is deliberately `null`; exact totals are returned separately in `value_reconciled_by_currency`.

## Submission artifacts

- [Five-minute pitch](./VIDEO_PITCH.md) — a timed, word-for-word recording script with exact screen actions and the complete 2 AM incident.
- [Architecture](./ARCHITECTURE.md) — safety boundaries, execution flow, invariants and production scale-out design.
- [Release evidence](./RELEASE_EVIDENCE.md) — reproducible quality gates and independent stress-test receipts.

The pitch is designed to show the engine running, inspect one messy narration decision, explain why the model cannot authorize money, and answer what broke at 2 AM with symptom, risk, diagnosis, fix and verification.
