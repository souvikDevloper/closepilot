# ClosePilot — final five-minute pitch

Record with the public app at `https://closepilot-finance.vercel.app`. Keep the camera bubble small and a terminal open in the repository. Text in square brackets is an on-screen action, not spoken narration.

## 0:00–0:30 — Problem and promise

[Show the Overview headline.]

Hi, I’m Souvik, and this is ClosePilot for Track 04, AI Finance Controller.

Finance teams close payments, invoices, settlements and bank credits across disconnected exports. The hard problem is closing the complete batch without silently forcing uncertain records.

ClosePilot is a bounded reconciliation agent built around one rule: models interpret, deterministic rules authorize, and uncertainty fails closed.

## 0:30–1:05 — Measured result

[Point to safe match rate, accuracy, exceptions and throughput.]

This labelled holdout has 1,000 primary records. ClosePilot safely resolves 960, or 96 percent, and returns the remaining 40 as honest exceptions: 10 for review and 30 blocked.

The 480 pair decisions resolve two endpoints each, so they account for those 960 records. The other 325 rows are settlement-proof evidence and never inflate the denominator.

On this synthetic holdout, precision and recall are 100 percent, with zero false automatic matches and zero silent drops. A separate 132,500-row development-machine run processed about 12,400 rows per second.

## 1:05–2:00 — Run the real engine and inspect a messy row

[Open Data lab and click **Run benchmark**.]

This button calls the same public, versioned API available to judges. They can upload CSV or JSON, omit ground truth for a blind run, or provide labels for measured accuracy.

[Open Decisions. Select a settlement-to-bank match whose bank narration resembles “RZP merchant settlement ... credited”. Open its evidence.]

The local Naive Bayes classifier tokenizes this messy narration and may label it as a settlement, but that adds at most three evidence points. It cannot release the match.

The deterministic engine requires authoritative evidence: exact UTR gives 70 points, exact net amount gives 25, and the date window gives up to 10. Release needs 85 points, exact money, and a 10-point lead over the runner-up.

If the same narration belongs to a debit, another currency or merchant, an ambiguous candidate, or non-exact money, it is rejected or reviewed. The model cannot overrule that boundary.

## 2:00–2:50 — Architecture and safety

[Open Architecture and move left to right across the flow.]

Schema guards normalize Razorpay, bank and ledger aliases into a canonical ledger. Money uses integer minor units, so floating point never authorizes a decision.

Bounded indexes generate candidates by ID, UTR, order, customer and amount, without an all-to-all scan.

The engine proves that aggregate settlement credits minus debits equal the declared total. A one-subunit difference blocks release.

Finally, an independent verifier re-reads canonical facts, checks one-to-one use, aggregate proof, thresholds and decision accounting, then produces a SHA-256 receipt. Any failed invariant aborts the result.

## 2:50–3:40 — Reproduce it and challenge it

[Show Audit trail, then the terminal. Run `npm run eval:holdout`.]

The repository has this one-command judge path and 21 tests covering ambiguity, duplicates, void invoices, bank debits, merchant and currency boundaries, malformed money and one-subunit proof tampering.

I also challenged the public API with an independent Orion pack: six CSVs, each above 10,000 rows, totalling 62,500 rows. It returned 22,000 verified pairs, 6,000 honest exceptions, 100 percent precision and recall on generated labels, zero false auto-matches, zero silent drops, and the same receipt as the local engine.

This is reproducible evidence, not a universal claim. Without ground truth, accuracy is null; with labels, it is measured. The hosted summary endpoint accepts up to 100,000 records.

## 3:40–4:30 — The 2 AM failure: what broke and how I got out

[Return to Overview, then show the release evidence in the repository.]

At 2 AM, the dashboard produced a spectacular throughput number. It was wrong.

The engine finished inside one coarse tick of the hosted edge clock, so elapsed time collapsed to zero and the rate became impossible. I also found that a blind run could resemble a scored run. In finance, impressive but false evidence is a correctness failure.

I reproduced it against a monotonic local benchmark and a browser-observed public round trip, then traced every metric to its numerator, denominator and source.

The fix was nullable timing when the clock is untrustworthy, explicit measurement labels, separate blind and scored states, and visible match-rate arithmetic. I added regression tests and replayed Nova and Orion locally and through the public API. The decisions and SHA-256 receipts matched.

That incident changed the product: ClosePilot now refuses to invent performance evidence in exactly the same way it refuses to invent a financial match.

## 4:30–5:00 — Close

[Show Overview, the API-live indicator, OpenAPI link and public GitHub link.]

ClosePilot closes a multi-source finance loop across thousands of records. It reports measured throughput, measured accuracy when labels exist, every exception and a verification receipt. The source is public, the evaluation is one command, and the API is judge-testable.

AI should not control money. ClosePilot demonstrates the safer idea: AI increases verification capacity while deterministic evidence keeps financial authority bounded.

That is ClosePilot. Thank you.
