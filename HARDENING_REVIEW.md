# Post-submission hardening evidence

Date: 2026-09-07. Engine 3.1.0, ruleset `closepilot-reconcile-v3.1`, verifier v2.

## Release boundary

This work was developed on `codex/post-submission-hardening`, starting from submitted commit `7c7d34c0a30251f83a3f7eba076bbbe639b6b8ca`. The original submission remains identifiable in Git history. On 2026-09-07 the owner requested a tested merge and an update to the existing public deployment. These are post-submission improvements, not evidence that the original submission contained them.

The public hostname, `envelope/vercel.json` forwarding, `.openai/hosting.json`, and `lib/public-origin.ts` are unchanged. The existing Vercel → Sites route stays in place. [UI and release checks](./UI_RELEASE_CHECKS.md) record validation of the refreshed workspace. A software release does not establish eligibility for retroactive buildathon judging.

## Reproduced defects and corrections

| Gap | Correction and regression evidence |
| --- | --- |
| Two equally valid payments could consume one invoice according to ordering | Match against an unchanged candidate graph; require mutual best evidence with forward and reverse margins. Payment and settlement competition tests withhold arbitrary winners. |
| Failed payments and sign-flipped amounts could match | Require a completed state when provided; preserve signs; reject negative obligations and contradictory credit/debit columns. Refunds/credit notes need a separate workflow. |
| Conflicting IDs could be outscored | Direct payment/invoice conflicts and contradictory UTRs are non-authorizing. Punctuation is preserved and identifier prefixes do not match longer IDs. |
| Strong-reference buckets escaped collision limits | Bound every candidate bucket. A 10,000-by-10,000 UTR collision test returns 20,000 explicit exceptions and no arbitrary match. |
| Verifier trusted decision scores and only one-sided uniqueness | Rebuild candidate evidence and validate two-sided margins, money/state, exception identities and accounting. Tests forge scores, source facts, destinations and proof totals. Shared scoring means common-mode bugs remain possible. |
| Timing omitted verification | Complete-engine timing now includes checksum, second-pass verification, receipt and result construction. A regression test advances the clock specifically during receipt creation. |
| Large allocation multipliers | Reuse the date formatter; retain top-two forward/reverse candidates; hash UTF-8 bytes without spreading into number arrays; reuse a SHA word buffer. Hashes cross-checked against Node crypto across padding boundaries, Unicode and multi-megabyte input. |
| Malformed CSV or labels could silently shift/drop data | Strict BOM/CRLF/quoted/multiline CSV parser, row width and header validation, record-only JSON and non-empty label IDs. Inputs are size-bounded. Spreadsheet-formula export cells are neutralized. |
| Upload/retry UI could mislead | Clear stale slot data on replacement; protect concurrent upload completion; prevent duplicate in-flight requests; timeout after three minutes; preserve the last successful result on request failure. No timer-driven fake stage progress. |
| Scores, classifier results, summaries and idempotency were overstated | Evidence points are not probabilities; classifier is explicitly a 12-phrase check; large CSV exports say sample; idempotency header is documented as a stable run label, not a replay store. |

## Executed quality gates

```bash
npm test
npm run lint
npm run typecheck
npm run build
node --experimental-strip-types scripts/evaluate-meridian.ts 12000 --export
node --experimental-strip-types scripts/compare-engine.ts ../site
```

The test suite contains 55 passing tests. It covers the engine, API alias/version/headers, authentication when configured, body-stream cancellation above 20 MiB, malformed inputs, summary accounting, OpenAPI metric/version consistency, Data lab parsing, label isolation, independent synthetic fixture expectations and receipt hashing.

This is not full formal verification, comprehensive OpenAPI schema validation, or a penetration test.

### Fresh Meridian data

Six CSV files generated independently of matcher output, using seed 9072026:

- 12,000 payments, 12,000 invoices, 12,000 settlements, 12,000 bank rows.
- 12,000 optional settlement proof rows and 19,200 optional ground-truth pairs.
- Three currencies, seven merchants, shuffled opaque identifiers, multiline/quoted narration, failed payments, negative amounts, currency and one-minor-unit discrepancies, contradictory references, bank debits and broken settlement proof.
- 48,000 primary = 38,400 matched endpoints + 9,600 exceptions (1,800 review + 7,800 blocked).
- 19,200 pairs; 80% resolution across all primary inputs; 100% pair precision/recall and zero false auto-matches **on this synthetic fixture**.
- 1,200 schema rejects remain in the primary denominator. Normalized-only match rate is ~82.05%, not the same metric as 80% all-input resolution.
- Blind labels produce identical decisions and receipt. Withholding proof is a different evidence condition: 19,800 expected pairs, using its separate truth file.
- Latest full-engine local run: 2,168 ms. In-process API handler including JSON encoding/decoding: 2,142 ms, excluding network. These are individual measurements, not percentile SLAs.
- Receipt: `76964a2bceba3e8c7f42e6bc56378e33af32ad758201abeb0729fa7c5d4fa4cd`.

The local browser accepted all six files and showed the expected 60,000 processed rows, 19,200 pairs and 9,600 exceptions. A negative payment's evidence drawer explicitly explained rejection instead of flipping its sign. The same parsing/request helpers are covered by automated CSV → engine and API tests.

The built production server was also tested through the interface: without proof/labels it reported 19,800 pairs and unknown accuracy; adding both produced 19,200 pairs and 9,600 exceptions, with 100% labelled pair precision/recall. Search narrowed a 200-decision summary sample correctly. No browser console errors were reported. During the subsequent UI release checks, CSV delivery was confirmed by parsing the actual saved files: 520 rows for a complete holdout response and 200 rows for the labelled Meridian summary sample. The in-app browser's download event was unreliable; the filesystem check verified delivery independently.

### Full-engine scale comparison

Windows, Node 22.14.0, Intel Core i5-12450H. 100,000 primary + 32,500 proof rows, 48,000 expected pairs and 4,000 exceptions. Each sample runs in a fresh process after one small warm-up. Fixture generation, HTTP and network are excluded. Original and initial hardened samples were alternated; final optimized samples were rerun after the hashing fix on the same machine.

| Version | Full-call samples (ms) | Median rows/s | Whole-process peak RSS |
| --- | --- | --- | --- |
| Submitted 3.0 | 18,046 / 17,083 / 16,781 | 7,756 | ~3,062 MiB |
| Hardened 3.1 | 4,588 / 4,504 / 4,707 | 28,877 | ~456 MiB |

About 3.7× better median throughput and 85% lower peak RSS in this local comparison, with unchanged expected pair outcomes. The original partial-stage throughput figures must not be compared directly to these complete-call timings. RSS includes the fixture, runtime, engine and result, not only the matching graph. Memory and runtime still vary with inputs and hardware.

## Explicit remaining production requirements

1. **Durability and isolation:** no persistent job queue, replay/conflict store, transactional outbox, durable audit database, tenant RBAC, per-tenant rate limits, cancellation/recovery protocol, or exactly-once posting. The evaluator is read-only. A shared optional API key is not tenant isolation.
2. **Hosting capacity:** the 100,000-record / 20 MiB API guards are admission bounds, not a tested concurrency or memory SLA. The 132,500-row CLI benchmark exceeds the hosted record guard and its ~456 MiB whole-process footprint does not prove fit in a 128 MiB edge worker. Summary mode limits output, not all internal memory. Validate the actual hosting plan and introduce durable bounded jobs before promising massive-scale hosted use.
3. **Source fidelity:** CSV/JSON are asserted facts, not authenticated bank/PSP evidence. Missing status, merchant and currency fields retain legacy defaults/compatibility. Real integrations require explicit adapter contracts and tenant context. Date windows add evidence; they are not a universal hard invoice-age cutoff.
4. **Coverage versus safety:** collision overflow intentionally abstains, even when another index has plausible evidence. Pairwise reconciliation does not implement partial/split invoice allocation, many-to-many payment allocation, FX conversion or a refund ledger.
5. **Evaluation strength:** fresh seeds and adversarial cases are useful regression tests, not an independently collected customer dataset. The tiny narration classifier is not production-trained or probability-calibrated. Unknown-data error rates remain unproven.
6. **Audit access:** the receipt is an unsigned reproducibility hash over selected facts/decisions, not proof of trusted origin or an immutable store. Large UI tables/exports contain samples. Complete large-run audit retrieval requires local full results or future durable pagination/storage.

These are release blockers for a multi-tenant money-moving production service, not hidden behind a “production-grade” label. The branch is a substantially hardened, testable read-only reconciliation engine with its Data lab preserved.
