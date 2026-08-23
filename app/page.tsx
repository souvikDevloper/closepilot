import ClosePilotClient from './closepilot-client';
import { createBenchmarkDataset } from '@/lib/benchmark.ts';
import { reconcile } from '@/lib/reconciliation.ts';

export default function Home() {
  const initialResult = reconcile(createBenchmarkDataset());
  return <ClosePilotClient initialResult={initialResult} />;
}
