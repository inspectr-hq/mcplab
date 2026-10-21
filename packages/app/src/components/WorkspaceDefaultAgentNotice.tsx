import { Link } from 'react-router-dom';
import type { AgentConfig } from '@/types/eval';

export function WorkspaceDefaultAgentNotice(props: {
  name?: string;
  loading: boolean;
  error?: string;
  agents: AgentConfig[];
}) {
  const agent = props.agents.find((item) => item.id === props.name);
  const error =
    props.error ??
    (agent?.type === 'browser'
      ? 'The workspace default must be an LLM agent. Choose another default or explicitly select a browser agent for this run.'
      : undefined);
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm" role="status">
      {props.loading ? (
        <p>Loading workspace default agent...</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : props.name ? (
        <>
          <p className="font-medium">Workspace default agent: {agent?.name || props.name}</p>
          <p className={agent ? 'text-muted-foreground' : 'text-destructive'}>
            {agent
              ? 'Inherited because this evaluation has no agents. You can change the selection when running it.'
              : 'This agent is no longer available. Choose another workspace default or select an agent for the run.'}
          </p>
        </>
      ) : (
        <p>
          No workspace default agent is set. Select an agent for the run or configure a default.
        </p>
      )}
      <Link to="/settings" className="text-primary hover:underline">
        Workspace settings
      </Link>
    </div>
  );
}
