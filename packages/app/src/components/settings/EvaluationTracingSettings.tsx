import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EvaluationTracingIntegration } from '@/types/eval';

const providers = {
  langsmith: {
    name: 'LangSmith',
    dashboardUrl: 'https://smith.langchain.com/',
    setupUrl: 'https://docs.langchain.com/langsmith/observability-quickstart'
  },
  langfuse: {
    name: 'Langfuse',
    dashboardUrl: 'https://cloud.langfuse.com',
    setupUrl: 'https://langfuse.com/docs/observability/get-started'
  }
};

const logos = {
  langsmith: {
    light: '/integrations/langsmith-light.svg',
    dark: '/integrations/langsmith-dark.svg'
  },
  langfuse: {
    light: '/integrations/langfuse-icon.svg',
    dark: '/integrations/langfuse-icon.svg'
  }
};

export function EvaluationTracingSettings({
  integrations
}: {
  integrations: EvaluationTracingIntegration[];
}) {
  if (!integrations.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Evaluation tracing</CardTitle>
        <CardDescription>
          Evaluation scenarios, LLM calls, and MCP tool calls are sent to these services, including
          prompts, responses, and tool inputs and results. Local run artifacts are saved as well.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {integrations.map((integration) => {
          const provider = providers[integration.provider];
          const logo = logos[integration.provider];
          const dashboardUrl =
            integration.provider === 'langfuse'
              ? (integration.endpoint ?? provider.dashboardUrl).replace(/\/$/, '')
              : provider.dashboardUrl;
          return (
            <div
              key={integration.provider}
              className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <img
                    src={logo.light}
                    alt={`${provider.name} logo`}
                    className="h-5 max-w-28 object-contain dark:hidden"
                  />
                  <img
                    src={logo.dark}
                    alt=""
                    aria-hidden="true"
                    className="hidden h-5 max-w-28 object-contain dark:block"
                  />
                  <h3 className="text-sm font-medium">{provider.name}</h3>
                  <Badge variant="secondary">Enabled</Badge>
                </div>
                {integration.project && (
                  <p className="break-all text-sm">Project: {integration.project}</p>
                )}
                <p className="break-all text-sm text-muted-foreground">
                  Endpoint: {integration.endpoint ?? 'Invalid endpoint configuration'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <Button asChild variant="outline" size="sm">
                  <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                    Open {provider.name} dashboard
                    <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
                <a
                  href={provider.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {provider.name} setup guide
                </a>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Enabled through the server environment. Trace delivery is best-effort; links appear with
          completed evaluation results.
        </p>
      </CardContent>
    </Card>
  );
}
