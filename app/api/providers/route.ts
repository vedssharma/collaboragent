import {
  getExecutionCapabilities,
  getProviderSummaries,
} from '@/lib/harness-catalog';
import { getConnectionSetup } from '@/lib/provider-config';
import { accessRequired } from '@/lib/access-control';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    providers: getProviderSummaries(),
    capabilities: getExecutionCapabilities(),
    setup: getConnectionSetup(),
    accessRequired: accessRequired(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
