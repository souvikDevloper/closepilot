export const runtime = 'edge';

export function GET() {
  return Response.json({
    status:'ok',
    service:'closepilot-reconciliation',
    api_version:'v1',
    engine_version:ENGINE_VERSION,
    ruleset:RULESET,
    verifier_version:VERIFIER_VERSION,
    exact_money:true,
  }, { headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} });
}
import { ENGINE_VERSION, RULESET, VERIFIER_VERSION } from '../../../lib/reconciliation.ts';
