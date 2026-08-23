export const runtime = 'edge';

export function GET() {
  return Response.json({
    status:'ok',
    service:'closepilot-reconciliation',
    api_version:'v1',
    engine_version:'3.0.0',
    ruleset:'closepilot-reconcile-v3',
    verifier_version:'closepilot-verifier-v1',
    exact_money:true,
  }, { headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} });
}
