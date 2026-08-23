# ClosePilot v3 release evidence

Status: **RELEASE CONFIRMED** for repository creation and evaluator deployment.

This confirmation covers the read-only reconciliation agent and public evaluation API. It does not authorize or implement money movement or source-system mutation.

## Final gates — 2026-08-23

- Unit/adversarial suite: 21/21 passing.
- Static analysis: zero lint errors or warnings.
- Production build: passing, including `/api/v1/reconcile`, `/api/health`, `/api/benchmark` and the legacy alias.
- OpenAPI 3.1 document: valid JSON with explicit metric denominator and nullable timing contracts.
- Local API smoke test: HTTP 200, exact settlement closure `Verified`, seven verifier invariants `PASS`, and receipt response header identical to the response body.
- Idempotency smoke test: repeated key + payload produced the same run ID and SHA-256 receipt.
- Unsafe policy test: an attempt to lower the automatic threshold returned HTTP 422.
- One-subunit tamper test: settlement closure changed to `Review` and no automatic match was released.

## Scale gate

The final local stress run processed:

- 100,000 primary records
- 32,500 Razorpay settlement recon evidence rows
- 132,500 total processed records
- 48,000 verified pairs
- 4,000 explicit exceptions
- 100% precision and recall on this labelled synthetic benchmark
- 0 false automatic matches
- 0 silent drops
- 10.67 seconds, approximately 12,421 records/second on the development machine

These measurements describe the committed deterministic benchmark, not a universal claim about unknown external data. The evaluator API is synchronously bounded; the production scale-out design for workloads above that limit is the sharded queue topology documented in `ARCHITECTURE.md`.

## Independent Nova gate

The separately generated Nova pack also passed:

- 2,420 primary records
- 2,390 successfully normalized records
- 1,000 ground-truth pairs
- all-input resolution rate: 82.64% (`2,000 / 2,420`)
- normalized safe-match rate: 83.68% (`2,000 / 2,390`)
- blind run accuracy metrics: `null` because labels were not supplied
- precision / recall / F1: 1 / 1 / 1
- false automatic match rate: 0
- silent drops: 0
- duplicate identifiers, ambiguity, malformed amounts and multi-currency accounting remained fail-closed
- absent settlement recon evidence was explicitly reported as not evaluated, while a separate supplied-proof smoke test verified one exact closure

The clean public endpoint repeated those blind, scored and supplied-proof results. Its hosted monotonic clock was too coarse to measure the Nova run, so duration and throughput were honestly returned as `null` rather than inferred.

GitHub release gates passed for the judge-honest metrics revision: https://github.com/souvikDevloper/closepilot/actions/runs/32647878627

The source is published at https://github.com/souvikDevloper/closepilot and the public evaluator deployment is available at https://closepilot-finance.vercel.app.
