# ClosePilot v3 release evidence

Status: **RELEASE CONFIRMED** for repository creation and evaluator deployment.

This confirmation covers the read-only reconciliation agent and public evaluation API. It does not authorize or implement money movement or source-system mutation.

## Final gates — 2026-08-23

- Unit/adversarial suite: 20/20 passing.
- Static analysis: zero lint errors or warnings.
- Production build: passing, including `/api/v1/reconcile`, `/api/health`, `/api/benchmark` and the legacy alias.
- OpenAPI 3.1 document: valid JSON and served locally.
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
- 14.51 seconds, approximately 9,130 records/second on the development machine

These measurements describe the committed deterministic benchmark, not a universal claim about unknown external data. The evaluator API is synchronously bounded; the production scale-out design for workloads above that limit is the sharded queue topology documented in `ARCHITECTURE.md`.

## Independent Nova gate

The separately generated Nova pack also passed:

- 2,420 primary records
- 1,000 ground-truth pairs
- precision / recall / F1: 1 / 1 / 1
- false automatic match rate: 0
- silent drops: 0
- duplicate identifiers, ambiguity, malformed amounts and multi-currency accounting remained fail-closed

The source is published at https://github.com/souvikDevloper/closepilot and the public evaluator deployment is available at https://closepilot.gshbholanath19.chatgpt.site.
