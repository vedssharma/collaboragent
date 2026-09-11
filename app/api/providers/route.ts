import {
  getExecutionCapabilities,
  getProviderSummaries,
} from '@/lib/harness-catalog';
import { getConnectionSetup } from '@/lib/provider-config';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    providers: getProviderSummaries(),
    capabilities: getExecutionCapabilities(),
    setup: getConnectionSetup(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
