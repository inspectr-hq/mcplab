import { useEffect, useState } from 'react';
import { ArrowLeftRight, ExternalLink } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { EvalResult } from '@/types/eval';
import { formatDurationMs, getRunToolTimeMs, getRunTotalDurationMs } from '@/lib/run-duration';

const resultUrl = (runId: string, configId?: string | null, agentId?: string | null) => {
  const params = new URLSearchParams();
  if (configId) params.set('configId', configId);
  if (agentId) params.set('agent', agentId);
  params.set('embed', '1');
  return `/results/${encodeURIComponent(runId)}?${params.toString()}`;
};

const openResultUrl = (runId: string, configId?: string | null, agentId?: string | null) => {
  const params = new URLSearchParams();
  if (configId) params.set('configId', configId);
  if (agentId) params.set('agent', agentId);
  const query = params.toString();
  return `/results/${encodeURIComponent(runId)}${query ? `?${query}` : ''}`;
};

const CompareResultDetails = () => {
  const { source } = useDataSource();
  const [searchParams] = useSearchParams();
  const left = searchParams.get('left') ?? '';
  const right = searchParams.get('right') ?? '';
  const leftConfig = searchParams.get('leftConfig');
  const rightConfig = searchParams.get('rightConfig');
  const leftAgent = searchParams.get('leftAgent');
  const rightAgent = searchParams.get('rightAgent');

  const leftLabel = leftAgent ? `${left} · ${leftAgent}` : left;
  const rightLabel = rightAgent ? `${right} · ${rightAgent}` : right;
  const [leftResult, setLeftResult] = useState<EvalResult | null>(null);
  const [rightResult, setRightResult] = useState<EvalResult | null>(null);

  useEffect(() => {
    if (!left || typeof source.getResult !== 'function') {
      setLeftResult(null);
      return;
    }
    let active = true;
    void source.getResult(left).then((result) => {
      if (active) setLeftResult(result ?? null);
    });
    return () => {
      active = false;
    };
  }, [left, source]);

  useEffect(() => {
    if (!right || typeof source.getResult !== 'function') {
      setRightResult(null);
      return;
    }
    let active = true;
    void source.getResult(right).then((result) => {
      if (active) setRightResult(result ?? null);
    });
    return () => {
      active = false;
    };
  }, [right, source]);

  if (!left || !right) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Full Result Compare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select exactly two runs in Compare and use the “Compare full results” action.
          </p>
          <Button asChild variant="outline">
            <Link to="/compare">Back to Compare</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Full Result Compare</h1>
          <p className="text-sm text-muted-foreground">
            {leftAgent || rightAgent
              ? 'Side-by-side Result Detail views for deep inspection, filtered by selected agents.'
              : 'Side-by-side Result Detail views for deep inspection.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/compare">
              <ArrowLeftRight className="mr-1.5 h-4 w-4" />
              Back to Compare
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={openResultUrl(left, leftConfig, leftAgent)} target="_blank" rel="noreferrer">
              Open Left
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href={openResultUrl(right, rightConfig, rightAgent)}
              target="_blank"
              rel="noreferrer"
            >
              Open Right
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/*<div className="grid gap-4 sm:grid-cols-2">*/}
      {/*  <Card>*/}
      {/*    <CardHeader className="pb-2">*/}
      {/*      <CardTitle className="text-xs font-medium text-muted-foreground">*/}
      {/*        Left Duration*/}
      {/*      </CardTitle>*/}
      {/*    </CardHeader>*/}
      {/*    <CardContent>*/}
      {/*      <div className="mt-1 font-mono text-xs text-muted-foreground">*/}
      {/*        Total time:{' '}*/}
      {/*        {(() => {*/}
      {/*          if (!leftResult) return '—';*/}
      {/*          const totalTimeMs = getRunTotalDurationMs(leftResult);*/}
      {/*          return totalTimeMs === null ? '—' : formatDurationMs(totalTimeMs);*/}
      {/*        })()}*/}
      {/*      </div>*/}
      {/*      <div className="mt-1 font-mono text-xs text-muted-foreground">*/}
      {/*        Tool time:{' '}*/}
      {/*        {(() => {*/}
      {/*          if (!leftResult) return '—';*/}
      {/*          const toolTimeMs = getRunToolTimeMs(leftResult);*/}
      {/*          return toolTimeMs === null ? '—' : formatDurationMs(toolTimeMs);*/}
      {/*        })()}*/}
      {/*      </div>*/}
      {/*    </CardContent>*/}
      {/*  </Card>*/}
      {/*  <Card>*/}
      {/*    <CardHeader className="pb-2">*/}
      {/*      <CardTitle className="text-xs font-medium text-muted-foreground">*/}
      {/*        Right Duration*/}
      {/*      </CardTitle>*/}
      {/*    </CardHeader>*/}
      {/*    <CardContent>*/}
      {/*      <div className="mt-1 font-mono text-xs text-muted-foreground">*/}
      {/*        Total time:{' '}*/}
      {/*        {(() => {*/}
      {/*          if (!rightResult) return '—';*/}
      {/*          const totalTimeMs = getRunTotalDurationMs(rightResult);*/}
      {/*          return totalTimeMs === null ? '—' : formatDurationMs(totalTimeMs);*/}
      {/*        })()}*/}
      {/*      </div>*/}
      {/*      <div className="mt-1 font-mono text-xs text-muted-foreground">*/}
      {/*        Tool time:{' '}*/}
      {/*        {(() => {*/}
      {/*          if (!rightResult) return '—';*/}
      {/*          const toolTimeMs = getRunToolTimeMs(rightResult);*/}
      {/*          return toolTimeMs === null ? '—' : formatDurationMs(toolTimeMs);*/}
      {/*        })()}*/}
      {/*      </div>*/}
      {/*    </CardContent>*/}
      {/*  </Card>*/}
      {/*</div>*/}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono">{leftLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              title={`Result ${leftLabel}`}
              src={resultUrl(left, leftConfig, leftAgent)}
              className="h-[calc(100vh-15rem)] w-full border-0"
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono">{rightLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              title={`Result ${rightLabel}`}
              src={resultUrl(right, rightConfig, rightAgent)}
              className="h-[calc(100vh-15rem)] w-full border-0"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CompareResultDetails;
