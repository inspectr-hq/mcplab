import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ProviderBadge } from '@/components/ProviderBadge';
import { AgentTypeIcon } from '@/components/AgentTypeIcon';
import { WORKSPACE_DEFAULT_LLM_AGENT_ERROR } from '@/lib/agent-messages';
import type { AgentConfig } from '@/types/eval';

function getNoticeTitle(loading: boolean, name: string | undefined, agent?: AgentConfig): string {
  if (loading) return 'Workspace default agent';
  if (!name) return 'No workspace default agent is set.';
  return `Workspace default agent: ${agent?.name || name}`;
}

function getNoticeDescription(
  loading: boolean,
  error: string | undefined,
  name: string | undefined,
  agent?: AgentConfig
): string | undefined {
  if (loading) return 'Loading workspace default agent...';
  if (error) return error;
  if (!name) return 'Select an agent for the run or configure a workspace default.';
  if (!agent) {
    return 'This agent is no longer available. Choose another workspace default or select an agent for the run.';
  }
}

export function WorkspaceDefaultAgentNotice(props: {
  name?: string;
  loading: boolean;
  error?: string;
  agents: AgentConfig[];
}) {
  const agent = props.agents.find((item) => item.id === props.name);
  const isBrowserAgent = agent?.type === 'browser';
  const error = props.error ?? (isBrowserAgent ? WORKSPACE_DEFAULT_LLM_AGENT_ERROR : undefined);
  const title = getNoticeTitle(props.loading, props.name, agent);
  const description = getNoticeDescription(props.loading, error, props.name, agent);
  return (
    <Card role="status">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
          <AgentTypeIcon agent={agent} />
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{title}</p>
            </div>
            {agent && (
              <div className="flex flex-wrap items-center gap-1.5">
                <ProviderBadge provider={agent.provider} />
                {isBrowserAgent
                  ? agent.url && (
                      <Badge variant="outline" className="max-w-full truncate font-mono text-xs">
                        {agent.url}
                      </Badge>
                    )
                  : agent.model && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {agent.model}
                      </Badge>
                    )}
              </div>
            )}
            {description && (
              <p
                className={
                  error || (props.name && !agent) ? 'text-destructive' : 'text-muted-foreground'
                }
              >
                {description}
              </p>
            )}
          </div>
          <Link
            to="/settings"
            className="inline-block whitespace-nowrap text-xs text-primary hover:underline"
          >
            Workspace settings
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
