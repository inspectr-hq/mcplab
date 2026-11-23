import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EvalConfig } from '@/types/eval';
import { AppRouteTree } from '@/App';
import { ConfigContext } from '@/contexts/useConfigs';
import { DataSourceContext } from '@/contexts/useDataSource';
import { LibraryContext } from '@/contexts/useLibraries';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  demoAgents,
  demoConfig,
  demoConfigSuite,
  demoScenarios,
  demoVersion,
  sourceFor
} from './fixture-data';

export function CoreScreenStory({
  path,
  populated,
  hasRunningQueue = false
}: {
  path: string;
  populated: boolean;
  hasRunningQueue?: boolean;
}) {
  const configs = populated ? [demoConfig, demoConfigSuite] : [];
  const libraries = {
    servers: populated
      ? [
          {
            id: 'weather-mcp',
            name: 'Weather MCP',
            transport: 'streamable-http' as const,
            url: 'https://example.test/mcp'
          },
          {
            id: 'mcp-lab',
            name: 'MCPLab',
            transport: 'streamable-http' as const,
            url: 'http://127.0.0.1:3011/mcp',
            inspectrEnabled: true
          }
        ]
      : [],
    agents: populated ? demoAgents : [],
    scenarios: populated ? demoScenarios : [],
    browserProviders: {},
    loading: false,
    setServers: async () => {},
    setAgents: async () => {},
    setScenarios: async () => {},
    reload: async () => {}
  };
  const configContext = {
    configs,
    loading: false,
    getConfig: (id: string) => configs.find((config) => config.id === id),
    addConfig: async (config: EvalConfig) => config,
    updateConfig: async (_id: string, config: EvalConfig) => config,
    deleteConfig: async () => {},
    cloneConfig: async () => demoConfig,
    reload: async () => {}
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <DataSourceContext.Provider
            value={{
              mode: 'workspace',
              connection: 'connected',
              version: demoVersion,
              source: sourceFor(populated, hasRunningQueue, path === '/')
            }}
          >
            <LibraryContext.Provider value={libraries}>
              <ConfigContext.Provider value={configContext}>
                <AppRouteTree />
              </ConfigContext.Provider>
            </LibraryContext.Provider>
          </DataSourceContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

export function StorySection({ children }: { children: ReactNode }) {
  return <div className="space-y-4 p-6">{children}</div>;
}
