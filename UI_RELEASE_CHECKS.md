# Midnight Ledger — UI and release checks

Date: 2026-09-07. Engine 3.1.0; no matching-policy changes in the visual refresh.

## What changed

- Unified midnight/mint design tokens, readable metadata, responsive metric cards and source coverage.
- All six views retained: Overview, Decisions, Exceptions, Audit trail, Architecture and Data lab.
- Real request state only. No generated activity feed, simulated stage progress or fabricated throughput.
- Primary-input and normalized-only rates stay distinct; unknown accuracy is shown as unscored.
- Native evidence dialog: keyboard focus containment, Escape dismissal and background scroll lock.
- Visible empty search results; current view indicated semantically; keyboard focus and reduced-motion styles.
- File replacement clears stale data. Reconciliation waits for all selected files to finish parsing; the same file can be selected again after clearing.
- Workspace navigation and completed runs return to the top. Wide tables scroll within their own container.
- Clipboard success is reported only after the write succeeds. Export labels preserve full/sample distinctions.

## Automated and executable checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
node --experimental-strip-types scripts/smoke-http.ts http://127.0.0.1:3011
```

55 engine/API/Data lab regression tests pass. The HTTP smoke check covers the homepage, health, OpenAPI, API discovery, a scored holdout, blind labels with unchanged receipt, and malformed JSON rejection. The smoke script can also target the public Vercel origin after publishing.

## Browser verification

| Check | Observed result |
| --- | --- |
| Benchmark through the UI | 1,000 primary records, 480 pairs, 40 exceptions; verified result replaces prior state |
| All six Data lab inputs | Existing Meridian CSVs accepted; each source reports its parsed row count |
| Parsing race guard | Reconcile was disabled while each of the six files was being read |
| Missing source pair | Visible validation error; no request accepted |
| Wrong JSON shape | A full request object in a single source slot is rejected as not an array of records |
| Large scored browser run | 60,000 primary + evidence rows; 19,200 pairs; 9,600 exceptions; 1,200 schema rejects; zero silent drops |
| Large-run denominators | 80.0% of all 48,000 primary inputs; 82.1% of normalized inputs; 100% labelled pair precision/recall on this synthetic fixture |
| Record search | Exact identifier narrows the table; unknown identifier produces a visible empty state |
| Evidence dialog | Correct reason, amount and bounded action; Escape closes the dialog |
| Audit and architecture | Run verifier PASS and all six recorded execution stages visible |
| Full CSV delivery | Actual downloaded CSV parsed successfully with 520 decision rows |
| Summary CSV delivery | Actual downloaded `-sample.csv` parsed successfully with 200 returned decision rows |
| Responsive layouts | All six views checked at 390px; overview also checked at 768px, 1440px and 1920px; no page-level horizontal overflow |
| Browser errors | No application console errors reported in the exercised local flows |

The download-event helper timed out even when the file was saved. This was resolved as a verification limitation by checking the actual downloaded artifacts, not by asserting that clicking a button proved delivery.

## Visual documentation

`docs/media/` contains real local browser screenshots. `workspace-tour.gif` is a four-frame, stepped walkthrough assembled from those captures with `scripts/render-readme-tour.py` (Pillow). It is not a real-time recording or a throughput demonstration. Static PNG alternatives are linked in the README.

## Release invariants

- Keep `https://closepilot-finance.vercel.app` unchanged.
- Keep the existing Vercel rewrites, Sites project identity and canonical public origin unchanged.
- Build the exact source committed for release; publish to the existing origin, not a replacement Site.
- Check the Vercel-facing homepage and versioned API after deployment; preserve the previous saved hosting version for rollback.

## Scope of the evidence

These checks establish the exercised UI and deterministic reconciliation paths. They are not a penetration test, a complete accessibility audit, proof of zero bugs, or a production concurrency SLA. The large measurements above were local. Hosted duration and memory remain environment-dependent; admission limits do not guarantee capacity. See [remaining production requirements](./HARDENING_REVIEW.md#explicit-remaining-production-requirements).
