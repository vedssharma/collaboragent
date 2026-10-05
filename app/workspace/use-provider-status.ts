'use client';

import { useCallback, useState } from 'react';
import type { ConnectionSetup } from '@/app/provider-connections';

type ProviderResponse = {
  providers?: { configured: boolean }[];
  capabilities?: { liveModels?: boolean; codingHarnesses?: boolean };
  setup?: ConnectionSetup;
  accessRequired?: boolean;
};

export function useProviderStatus() {
  const [configuredProviders, setConfiguredProviders] = useState(0);
  const [setup, setSetup] = useState<ConnectionSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [harnessAvailable, setHarnessAvailable] = useState(false);
  const [accessRequired, setAccessRequired] = useState(false);

  const refresh = useCallback(() => {
    return fetch('/api/providers', { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error('Connection status unavailable');
      return response.json() as Promise<ProviderResponse>;
    }).then((data) => {
      setAccessRequired(Boolean(data.accessRequired));
      setConfiguredProviders(data.providers?.filter((provider) => provider.configured).length ?? 0);
      setLiveAvailable(Boolean(data.capabilities?.liveModels));
      setHarnessAvailable(Boolean(data.capabilities?.codingHarnesses));
      setSetup(data.setup ?? null);
      return data;
    }).catch(() => {
      setSetup(null);
      setLiveAvailable(false); setHarnessAvailable(false);
      return null;
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    return refresh();
  }, [refresh]);

  return { configuredProviders, setup, loading, liveAvailable, harnessAvailable, accessRequired, setAccessRequired, refresh, reload };
}
