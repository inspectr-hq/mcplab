import { Link } from 'react-router-dom';
import { Bot, Globe2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ProviderBadge } from '@/components/ProviderBadge';
import type { AgentConfig } from '@/types/eval';

export function WorkspaceDefaultAgentNotice(props: {
  name?: string;
  loading: boolean;
  error?: string;
  agents: AgentConfig[];
}) {
  const agent = props.agents.find((item) => item.id === props.name);
  const isBrowserAgent = agent?.type === 'browser';
  const AgentIcon = isBrowserAgent ? Globe2 : Bot;
  const error =
    props.error ??
    (isBrowserAgent
      ? 'The workspace default must be an LLM agent. Choose another default or explicitly select a browser agent for this run.'
      : undefined);
  const description = props.loading
    ? 'Loading workspace default agent...'
    : error ??
      (props.name
        ? agent
          ? undefined
          : 'This agent is no longer available. Choose another workspace default or select an agent for the run.'
        : 'Select an agent for the run or configure a workspace default.');
  return (
    <Card role="status">
      <CardContent className="flex items-start gap-3 p-4">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"
          title={isBrowserAgent ? 'Browser agent' : 'LLM agent'}
        >
          <AgentIcon
            className={`h-4 w-4 ${isBrowserAgent ? 'text-sky-600' : 'text-muted-foreground'}`}
            aria-hidden="true"
          />
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {props.loading
                  ? 'Workspace default agent'
                  : props.name
                    ? `Workspace default agent: ${agent?.name || props.name}`
                    : 'No workspace default agent is set.'}
              </p>
            </div>
            {agent && (
              <div className="flex flex-wrap items-center gap-1.5">
                <ProviderBadge provider={agent.provider} />
                {isBrowserAgent ? (
                  agent.url && (
                    <Badge variant="outline" className="max-w-full truncate font-mono text-xs">
                      {agent.url}
                    </Badge>
                  )
                ) : (
                  agent.model && (
                    <Badge variant="outline" className="font-mono text-xs">
                      {agent.model}
                    </Badge>
                  )
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
