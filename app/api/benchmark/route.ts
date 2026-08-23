import { createBenchmarkDataset } from '@/lib/benchmark.ts';

export const runtime = 'edge';

export function GET(request: Request) {
  const scale = Math.min(10, Math.max(1, Number(new URL(request.url).searchParams.get('scale') ?? 1)));
  return new Response(JSON.stringify(createBenchmarkDataset(scale)), {
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition':`attachment; filename="closepilot-benchmark-${scale * 1000}-records.json"`,
      'Cache-Control':'public, max-age=3600',
      'Access-Control-Allow-Origin':'*',
    },
  });
}
