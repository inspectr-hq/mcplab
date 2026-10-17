import { inspectrTraceKey, useOpenInspectrTrace } from '@/hooks/use-open-inspectr-trace';
import type { ScenarioResult } from '@/types/eval';
import { RunTraceButton, type RunTraceItem } from './RunTraceButton';

/** LangSmith and Inspectr trace links for the runs of one scenario-agent result. */
export function ScenarioTraceButtons({
  runId,
  scenario,
  langsmithTraceUrls
}: {
  /** Result run ID the scenario belongs to; Inspectr sessions are validated against it. */
  runId: string | undefined;
  scenario: ScenarioResult;
  langsmithTraceUrls?: Record<string, string>;
}) {
  const { openingTrace, openTrace } = useOpenInspectrTrace(runId);
  const runLabel = (runIndex: number) => `Run #${runIndex + 1}`;
  const langsmithItems: RunTraceItem[] = scenario.runs.flatMap((run) => {
    const url = run.requestId ? langsmithTraceUrls?.[run.requestId] : undefined;
    return url
      ? [
          {
            key: url,
            label: runLabel(run.runIndex),
            open: () => void window.open(url, '_blank', 'noopener,noreferrer')
          }
        ]
      : [];
  });
  const origins = scenario.inspectrOrigins ?? [];
  const inspectrItems: RunTraceItem[] = origins.flatMap((origin) =>
    scenario.runs.flatMap((run) => {
      const requestId = run.requestId;
      if (!requestId) return [];
      const host = origins.length > 1 ? ` (${new URL(origin).host})` : '';
      return [
        {
          key: inspectrTraceKey(origin, requestId),
          label: `${runLabel(run.runIndex)}${host}`,
          open: () => void openTrace(origin, requestId)
        }
      ];
    })
  );

  return (
    <>
      <RunTraceButton
        name="LangSmith trace"
        title="Open the LangSmith trace"
        items={langsmithItems}
      />
      <RunTraceButton
        name="Inspectr trace"
        title="Open the MCP requests in Inspectr (starts Inspectr if needed)"
        items={inspectrItems}
        disabled={openingTrace !== null}
        busy={inspectrItems.some((item) => item.key === openingTrace)}
      />
    </>
  );
}
