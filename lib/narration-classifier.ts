export type NarrationClass = 'settlement' | 'refund' | 'tds' | 'fee' | 'payout' | 'unknown';

const TRAINING: Record<NarrationClass, string[]> = {
  settlement: [
    'razorpay settlement credit utr merchant',
    'rzp settlement received payment gateway',
    'merchant settlement net credit',
    'payment aggregator settlement batch',
    'settlement proceeds credited to bank',
    'razorpay daily settlement transfer',
  ],
  refund: [
    'customer refund debit reversed payment',
    'refund processed against order',
    'payment refund to card customer',
    'reversal refund transaction debit',
    'partial refund issued to buyer',
    'refund initiated payment gateway',
  ],
  tds: [
    'tax deducted at source tds deduction',
    'customer tds withholding adjustment',
    'income tax tds receivable',
    'withholding tax deducted invoice',
    'tds deduction against professional invoice',
    'tax withheld by customer',
  ],
  fee: [
    'gateway processing fee debit',
    'merchant discount rate mdr charge',
    'payment processing fees and tax',
    'bank service charge debit',
    'razorpay platform fee gst',
    'transaction fee adjustment',
  ],
  payout: [
    'vendor payout bank transfer',
    'beneficiary payout processed',
    'salary payout debit transfer',
    'supplier payment payout',
    'outbound payout to beneficiary',
    'payout batch debit',
  ],
  unknown: [
    'neft credit transfer',
    'upi transaction received',
    'bank transfer miscellaneous',
    'cash deposit branch',
    'opening balance adjustment',
    'manual journal entry',
  ],
};

const HOLDOUT: Array<[string, NarrationClass]> = [
  ['RZP merchant proceeds settled today', 'settlement'],
  ['gateway batch settlement UTR posted', 'settlement'],
  ['buyer refund reversal completed', 'refund'],
  ['partial amount returned to customer', 'refund'],
  ['withholding tax on invoice', 'tds'],
  ['customer deducted ten percent TDS', 'tds'],
  ['MDR and GST charges', 'fee'],
  ['processing charge for captured payments', 'fee'],
  ['vendor beneficiary transfer', 'payout'],
  ['outbound supplier disbursement', 'payout'],
  ['unidentified NEFT receipt', 'unknown'],
  ['cash counter deposit', 'unknown'],
];

const tokenize = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(/\s+/)
  .filter((token) => token.length > 1);

const classes = Object.keys(TRAINING) as NarrationClass[];
const vocabulary = new Set<string>();
const tokenCounts = new Map<NarrationClass, Map<string, number>>();
const classTotals = new Map<NarrationClass, number>();

for (const label of classes) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const example of TRAINING[label]) {
    for (const token of tokenize(example)) {
      vocabulary.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
      total += 1;
    }
  }
  tokenCounts.set(label, counts);
  classTotals.set(label, total);
}

export function classifyNarration(value: string): { label: NarrationClass; confidence: number; scores: Record<NarrationClass, number>; abstained:boolean; vocabulary_coverage:number } {
  const allTokens = tokenize(value);
  const tokens = allTokens.filter((token) => vocabulary.has(token));
  const coverage = allTokens.length ? tokens.length / allTokens.length : 0;
  // Unseen words cannot accumulate spurious confidence merely because class
  // vocabularies differ in size. Unknown text contributes no matching evidence.
  if (tokens.length < 2 || coverage < 0.4) return {
    label:'unknown',confidence:0,
    scores:Object.fromEntries(classes.map((label) => [label,1 / classes.length])) as Record<NarrationClass,number>,
    abstained:true,vocabulary_coverage:coverage,
  };
  const logScores = {} as Record<NarrationClass, number>;
  for (const label of classes) {
    const counts = tokenCounts.get(label)!;
    const denominator = (classTotals.get(label) ?? 0) + vocabulary.size;
    let score = Math.log(1 / classes.length);
    for (const token of tokens) score += Math.log(((counts.get(token) ?? 0) + 1) / denominator);
    logScores[label] = score;
  }
  const maxLog = Math.max(...classes.map((label) => logScores[label]));
  const exponentials = classes.map((label) => Math.exp(logScores[label] - maxLog));
  const denominator = exponentials.reduce((sum, item) => sum + item, 0);
  const scores = {} as Record<NarrationClass, number>;
  classes.forEach((label, index) => { scores[label] = exponentials[index] / denominator; });
  const label = classes.reduce((best, candidate) => scores[candidate] > scores[best] ? candidate : best, classes[0]);
  return { label, confidence: scores[label], scores, abstained:false, vocabulary_coverage:coverage };
}

export function evaluateNarrationClassifier() {
  const correct = HOLDOUT.filter(([text, expected]) => classifyNarration(text).label === expected).length;
  return { correct, total: HOLDOUT.length, accuracy: correct / HOLDOUT.length };
}
