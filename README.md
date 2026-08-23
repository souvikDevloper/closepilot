# ClosePilot

ClosePilot is a fail-closed reconciliation agent for Razorpay payments, settlements, bank transactions and invoice ledgers. It converts exported CSV/JSON data into explainable matches, an honest exception queue and reproducible run metrics.

## What is real

- The UI calls the same `POST /api/reconcile` endpoint available to evaluators.
- All dashboard metrics are calculated by the engine for the displayed batch.
- Candidate generation uses bounded indexes instead of a Cartesian scan.
- Currency, merchant scope, bank direction, duplicate IDs, void invoices, confidence and ambiguity are hard safety gates.
- A local Naive Bayes model classifies messy bank narrations. It can provide evidence but cannot authorize a financial decision.
- The API does not move money or modify source systems.

## Reproducible benchmark

```bash
npm test
npm run benchmark -- 100
```

The committed holdout generator produces 1,000 records: 480 labelled pairs plus 40 deliberately ambiguous or unmatched records. The automated suite also processes a 10,000-record variant and verifies that ambiguity, malformed inputs, cross-currency candidates, cross-merchant candidates and bank debits fail closed.

Latest local 100,000-record run on the development machine:

- 48,000 matched pairs
- 4,000 honest exception records
- 100% precision and recall on the generated labelled holdout
- 0 false automatic matches
- 0 silent drops
- ~9,800 records/second

Performance is hardware-dependent. These figures describe the committed synthetic benchmark, not an unsupported claim about all external data.

## Public evaluation API

```bash
curl -X POST https://closepilot.gshbholanath19.chatgpt.site/api/reconcile \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evaluator-run-001" \
  -d @examples/request.json
```

Useful endpoints:

- `GET /api/reconcile` — contract, limits and example
- `POST /api/reconcile` — execute a batch
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
  "ground_truth": [{ "left_id": "pay_001", "right_id": "inv_001" }],
  "response_mode": "full"
}
```

Ground truth is optional. When supplied, the response calculates precision, recall, F1 and false-auto-match rate. Without it, those metrics are returned as `null` instead of being invented.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for safety, scale and production deployment design.
