# ClosePilot

ClosePilot is a bounded, fail-closed reconciliation agent for Razorpay payments, settlement recon items, settlements, bank transactions and invoice ledgers. It turns exported CSV/JSON into explainable matches, aggregate cash-closure proofs, an honest exception queue and reproducible verification receipts.

## Live evaluator deployment

- App: https://closepilot.gshbholanath19.chatgpt.site
- Evaluation API: https://closepilot.gshbholanath19.chatgpt.site/api/v1/reconcile
- OpenAPI 3.1: https://closepilot.gshbholanath19.chatgpt.site/openapi.json
- Health check: https://closepilot.gshbholanath19.chatgpt.site/api/health

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

## Reproducible benchmark

```bash
npm test
npm run benchmark -- 100
```

The committed holdout generator produces 1,000 primary records plus 325 Razorpay settlement evidence rows: 480 labelled pairs plus 40 deliberately ambiguous or unmatched primary records. The automated suite also processes a 10,000-primary-record variant and verifies exact money, deterministic receipts, aggregate settlement proof, one-subunit tampering, ambiguity, malformed inputs, duplicate evidence, cross-currency candidates, cross-merchant candidates and bank debits.

Latest local run with 100,000 primary records plus 32,500 settlement evidence rows on the development machine:

- 48,000 matched pairs
- 4,000 honest exception records
- 100% precision and recall on the generated labelled holdout
- 0 false automatic matches
- 0 silent drops
- ~9,100 primary + evidence records/second

Performance is hardware-dependent. These figures describe the committed synthetic benchmark, not an unsupported claim about all external data.

## Public evaluation API

```bash
curl -X POST https://closepilot.gshbholanath19.chatgpt.site/api/v1/reconcile \
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

`settlement_recon_items` accepts Razorpay settlement recon rows. `credit`, `debit`, `fee` and `tax` are integer currency subunits. Fees and tax are evidence fields; the authoritative settlement net is `sum(credit - debit)`, so they are not subtracted twice.

For multi-currency batches, `value_reconciled` is deliberately `null`; exact totals are returned separately in `value_reconciled_by_currency`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for safety, scale and production deployment design.
