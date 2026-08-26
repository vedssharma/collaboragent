import {
  getExecutionCapabilities,
  getProviderSummaries,
} from '@/lib/harness-catalog';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    providers: getProviderSummaries(),
    capabilities: getExecutionCapabilities(),
  });
}
