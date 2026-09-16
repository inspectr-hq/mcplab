import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Plus, Pencil, Copy, Trash2, Bot, Globe2 } from 'lucide-react';
import { useLibraries } from '@/contexts/LibraryContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchInput } from '@/components/SearchInput';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { ProviderBadge } from '@/components/ProviderBadge';
import { toast } from '@/hooks/use-toast';
import { resolveAgentTemperature } from '@/lib/agent-temperature';
import type { AgentConfig } from '@/types/eval';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AgentType = 'llm' | 'browser';

interface AgentsProps {
  defaultType?: AgentType;
}

const Agents = ({ defaultType = 'llm' }: AgentsProps) => {
  const { agents, setAgents, reload, loading } = useLibraries();
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<AgentConfig | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentTypeFilter, setAgentTypeFilter] = useState<AgentType>(defaultType);
  const normalizedAgentFilter = agentFilter.trim().toLowerCase();
  useEffect(() => {
    setAgentTypeFilter(defaultType);
  }, [defaultType]);

  const handleTypeChange = (value: string) => {
    const nextType = value as AgentType;
    setAgentTypeFilter(nextType);
    navigate(`/libraries/agents/${nextType}`);
  };
  const agentCounts = useMemo(
    () => ({
      llm: agents.filter((agent) => (agent.type ?? 'llm') === 'llm').length,
      browser: agents.filter((agent) => agent.type === 'browser').length
    }),
    [agents]
  );
  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if ((agent.type ?? 'llm') !== agentTypeFilter) return false;
        if (normalizedAgentFilter.length === 0) return true;
        const searchableText = [
          agent.name,
          agent.provider,
          agent.model,
          agent.type === 'browser' ? agent.url : undefined
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchableText.includes(normalizedAgentFilter);
      }),
    [agents, normalizedAgentFilter, agentTypeFilter]
  );

  const handleDuplicate = async (agent: AgentConfig) => {
    const baseName = `${agent.name}-copy`;
    let newName = baseName;
    let suffix = 1;
    while (agents.some((a) => a.name === newName)) {
      newName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    const duplicate: AgentConfig = {
      ...structuredClone(agent),
      id: `agt-${Date.now()}`,
      name: newName
    };
    await setAgents([...agents, duplicate]);
    toast({ title: 'Agent duplicated', description: `Created ${newName}.` });
  };

  const handleDelete = async (agent: AgentConfig) => {
    await setAgents(agents.filter((a) => a.id !== agent.id));
    toast({ title: 'Agent deleted', description: `${agent.name} was removed.` });
    setPendingDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <Bot className="h-6 w-6" />
            Agents
          </h1>
          <p className="text-sm text-muted-foreground">
            Reusable agent profiles shared across configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput
            value={agentFilter}
            onValueChange={setAgentFilter}
            placeholder="Search agents..."
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => navigate(`/libraries/agents/new?type=${agentTypeFilter}`)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Agent
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No agents configured. Add one to get started.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-4"
            onClick={() => navigate(`/libraries/agents/new?type=${agentTypeFilter}`)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Agent
          </Button>
        </div>
      ) : (
        <Tabs
          value={agentTypeFilter}
          onValueChange={handleTypeChange}
          className="space-y-4"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2" aria-label="Agent type">
            <TabsTrigger value="llm">LLM ({agentCounts.llm})</TabsTrigger>
            <TabsTrigger value="browser">Browser ({agentCounts.browser})</TabsTrigger>
          </TabsList>

          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <p className="text-sm text-muted-foreground">No agents match this filter.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Provider</TableHead>
                      {agentTypeFilter === 'browser' ? (
                        <>
                          <TableHead>URL</TableHead>
                          <TableHead>Conversation</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead>Model</TableHead>
                          <TableHead>Max Tokens</TableHead>
                          <TableHead>Temperature</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.map((agent) => (
                      <TableRow
                        key={agent.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/libraries/agents/${encodeURIComponent(agent.id)}`)}
                      >
                        <TableCell className="font-medium">
                          <span
                            className="inline-flex items-center gap-2"
                            title={agent.type === 'browser' ? 'Browser agent' : 'LLM agent'}
                          >
                            {agent.type === 'browser' ? (
                              <Globe2 className="h-4 w-4 text-sky-600" aria-hidden="true" />
                            ) : (
                              <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            )}
                            {agent.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ProviderBadge provider={agent.provider} />
                        </TableCell>
                        {agent.type === 'browser' ? (
                          <>
                            <TableCell>
                              <span
                                className="max-w-xs truncate font-mono text-xs"
                                title={agent.url}
                              >
                                {agent.url || 'Not configured'}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">
                              {agent.newConversationBetweenScenarios === false
                                ? 'Continue same conversation'
                                : 'New conversation per scenario'}
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell>
                              <span className="font-mono text-xs">{agent.model}</span>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{agent.maxTokens}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {resolveAgentTemperature(agent.temperature).toFixed(2)}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setPendingDelete(agent)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDuplicate(agent)}
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Duplicate
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(`/libraries/agents/${encodeURIComponent(agent.id)}`)
                              }
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </Tabs>
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-mono">{pendingDelete?.name}</span>{' '}
              from the library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete);
              }}
            >
              Delete Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Agents;
