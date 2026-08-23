export const runtime = 'edge';

export function GET() {
  return Response.json({status:'ok',service:'closepilot-reconciliation',engine_version:'2.0.0',ruleset:'closepilot-reconcile-v2'});
}
