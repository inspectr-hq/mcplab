import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Play, Square, Download, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLibraries } from '@/contexts/LibraryContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';
import type {
  OAuthDebuggerSessionConfig,
  OAuthDebuggerSessionEvent,
  OAuthDebuggerSessionView
} from '@/lib/data-sources/types';

type ViewStep = 'configure' | 'run' | 'report';
type RegistrationMethod = 'pre_registered' | 'dcr' | 'cimd';

const STEP_LABELS: Array<{ id: ViewStep; label: string }> = [
  { id: 'configure', label: 'Configure Debug Session' },
  { id: 'run', label: 'Run / Inspect Flow' },
  { id: 'report', label: 'Report / Export' }
];

function copyText(text: string) {
  return navigator.clipboard.writeText(text);
}

function oauthDebuggerApiBase(): string {
  if (typeof window === 'undefined') return '';
  return window.location.port === '8685' ? 'http://127.0.0.1:8787' : '';
}

function toMarkdownClient(session: OAuthDebuggerSessionView, events: OAuthDebuggerSessionEvent[]) {
  const lines: string[] = [];
  lines.push('# OAuth Debugger Report');
  lines.push('');
  lines.push(`- Session ID: ${session.id}`);
  lines.push(`- Status: ${session.status}`);
  lines.push(`- Registration method: ${session.registrationMethod}`);
  lines.push(`- Profile: ${session.profile}`);
  lines.push('');
  lines.push('## Steps');
  for (const step of session.stepStates) {
    lines.push(`- ${step.title}: ${step.status}${step.outcomeSummary ? ` — ${step.outcomeSummary}` : ''}`);
  }
  lines.push('');
  lines.push('## Validation Findings');
  if (session.validations.length === 0) {
    lines.push('- None');
  } else {
    for (const v of session.validations) {
      lines.push(`- [${v.severity}] ${v.title} (${v.stepId})`);
      lines.push(`  - ${v.detail}`);
      if (v.recommendation) lines.push(`  - Recommendation: ${v.recommendation}`);
    }
  }
  lines.push('');
  lines.push('## Event Log');
  for (const event of events) {
    const msg =
      typeof event.payload.message === 'string' ? event.payload.message : JSON.stringify(event.payload);
    lines.push(`- ${new Date(event.ts).toLocaleTimeString()} [${event.type}] ${msg}`);
  }
  return `${lines.join('\n')}\n`;
}

export default function OAuthDebuggerPage() {
  const { source, mode } = useDataSource();
  const { servers, reload: reloadLibraries, loading: librariesLoading } = useLibraries();
  const [oauthDebuggerEnabled, setOauthDebuggerEnabled] = useState(false);
  const [loadingFlag, setLoadingFlag] = useState(false);
  const oauthFlagKey = 'mcplab.feature.oauthDebugger';

  const [viewStep, setViewStep] = useState<ViewStep>('configure');
  const [selectedServerId, setSelectedServerId] = useState('');
  const [registrationMethod, setRegistrationMethod] = useState<RegistrationMethod>('pre_registered');
  const [redirectMode, setRedirectMode] = useState<'local_callback' | 'manual'>('local_callback');
  const [showSensitiveValues, setShowSensitiveValues] = useState(true);
  const [usePkce, setUsePkce] = useState(true);
  const [scopesText, setScopesText] = useState('');
  const [resource, setResource] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tokenEndpointAuthMethod, setTokenEndpointAuthMethod] = useState('client_secret_basic');
  const [dcrMetadataJson, setDcrMetadataJson] = useState('{}');
  const [cimdUrl, setCimdUrl] = useState('');
  const [expectedClientId, setExpectedClientId] = useState('');
  const [authorizationServerMetadataUrl, setAuthorizationServerMetadataUrl] = useState('');
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState('');
  const [tokenEndpoint, setTokenEndpoint] = useState('');
  const [registrationEndpoint, setRegistrationEndpoint] = useState('');
  const [resourceBaseUrl, setResourceBaseUrl] = useState('');
  const [manualCallbackUrl, setManualCallbackUrl] = useState('');

  const [session, setSession] = useState<OAuthDebuggerSessionView | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<OAuthDebuggerSessionEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [inspectorStepFilter, setInspectorStepFilter] = useState<string>('all');
  const [inspectorStatusFilter, setInspectorStatusFilter] = useState<string>('all');
  const [networkTab, setNetworkTab] = useState<'inspector' | 'sequence'>('inspector');
  const unsubscribeRef = useRef<null | (() => void)>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const readFlag = () => {
      if (typeof window === 'undefined') return false;
      const raw = window.localStorage.getItem(oauthFlagKey);
      return raw === '1' || raw === 'true';
    };
    setLoadingFlag(true);
    const sync = () => setOauthDebuggerEnabled(readFlag());
    sync();
    const onStorage = () => sync();
    window.addEventListener('storage', onStorage);
    setLoadingFlag(false);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  const selectedServer = servers.find((s) => s.id === selectedServerId);

  const progressModel = useMemo(() => {
    const total = session?.stepStates.length ?? 0;
    const completed = session?.stepStates.filter((s) => s.status === 'completed' || s.status === 'skipped').length ?? 0;
    const failed = session?.stepStates.filter((s) => s.status === 'failed').length ?? 0;
    const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
    return { total, completed, failed, percent };
  }, [session]);

  const filteredNetwork = useMemo(() => {
    const exchanges = session?.network ?? [];
    return exchanges.filter((e) => {
      if (inspectorStepFilter !== 'all' && e.stepId !== inspectorStepFilter) return false;
      if (inspectorStatusFilter === 'error' && !(e.phase === 'response' && (e.status ?? 0) >= 400)) return false;
      if (inspectorStatusFilter === 'ok' && !(e.phase === 'response' && (e.status ?? 0) < 400)) return false;
      return true;
    });
  }, [session?.network, inspectorStepFilter, inspectorStatusFilter]);

  const canGoRun = Boolean(sessionId);
  const canGoReport = Boolean(session && (session.status === 'completed' || session.status === 'error' || session.status === 'stopped'));

  const setStepIfAllowed = (next: ViewStep) => {
    if (next === 'configure') return setViewStep(next);
    if (next === 'run' && canGoRun) return setViewStep(next);
    if (next === 'report' && canGoReport) return setViewStep(next);
  };

  const buildConfig = (): OAuthDebuggerSessionConfig => {
    let dcrMetadata: Record<string, unknown> | undefined;
    if (registrationMethod === 'dcr' && dcrMetadataJson.trim()) {
      try {
        dcrMetadata = JSON.parse(dcrMetadataJson);
      } catch {
        throw new Error('DCR metadata JSON is invalid');
      }
    }
    if (!selectedServer) throw new Error('Select an MCP server');
    return {
      profile: 'latest',
      target: {
        serverName: selectedServer.id,
        overrides: {
          authorizationServerMetadataUrl: authorizationServerMetadataUrl || undefined,
          authorizationEndpoint: authorizationEndpoint || undefined,
          tokenEndpoint: tokenEndpoint || undefined,
          registrationEndpoint: registrationEndpoint || undefined,
          cimdUrl: cimdUrl || undefined,
          resourceBaseUrl: resourceBaseUrl || undefined
        }
      },
      registrationMethod,
      clientConfig: {
        preRegistered:
          registrationMethod === 'pre_registered'
            ? {
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim() || undefined,
                tokenEndpointAuthMethod: tokenEndpointAuthMethod || undefined
              }
            : undefined,
        dcr:
          registrationMethod === 'dcr'
            ? {
                metadata: dcrMetadata,
                tokenEndpointAuthMethod: tokenEndpointAuthMethod || undefined
              }
            : undefined,
        cimd:
          registrationMethod === 'cimd'
            ? {
                cimdUrl: cimdUrl || undefined,
                expectedClientId: expectedClientId || undefined
              }
            : undefined
      },
      runtime: {
        redirectMode,
        scopes: scopesText
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        resource: resource.trim() || undefined,
        usePkce,
        codeChallengeMethod: 'S256'
      },
      display: {
        showSensitiveValues
      }
    };
  };

  const subscribeSession = (id: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = source.subscribeOAuthDebuggerSession(id, (event) => {
      setEvents((prev) => [...prev, event]);
      const terminal = event.type === 'completed' || event.type === 'error' || event.type === 'stopped';
      if (terminal) {
        setRunning(false);
      }
      void source.getOAuthDebuggerSession(id).then((response) => {
        setSession(response.session);
        if (response.session.status === 'completed' || response.session.status === 'error' || response.session.status === 'stopped') {
          setViewStep('report');
        }
      }).catch(() => {
        // ignore race while session expires/tears down
      });
    });
  };

  const createAndStart = async () => {
    if (mode !== 'workspace') {
      toast({ title: 'OAuth Debugger is only available in workspace mode', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const config = buildConfig();
      const created = await source.createOAuthDebuggerSession(config);
      setSessionId(created.sessionId);
      setSession(created.session);
      setEvents([]);
      setViewStep('run');
      subscribeSession(created.sessionId);
      const started = await source.startOAuthDebuggerSession(created.sessionId);
      setSession(started.session);
      setRunning(true);
      if (started.session.status === 'waiting_for_user' || started.session.status === 'waiting_for_browser_callback') {
        setRunning(false);
      }
    } catch (error: any) {
      toast({
        title: 'Could not start OAuth Debugger session',
        description: String(error?.message ?? error),
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resumeSession = async () => {
    if (!sessionId) return;
    setRunning(true);
    const response = await source.startOAuthDebuggerSession(sessionId);
    setSession(response.session);
  };

  const submitManualCallback = async () => {
    if (!sessionId) return;
    try {
      setSubmitting(true);
      const response = await source.submitOAuthDebuggerManualCallback(sessionId, {
        redirectUrl: manualCallbackUrl.trim() || undefined
      });
      setSession(response.session);
      setManualCallbackUrl('');
      setRunning(true);
    } catch (error: any) {
      toast({
        title: 'Could not submit callback',
        description: String(error?.message ?? error),
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const stopSession = async () => {
    if (!sessionId) return;
    setStopping(true);
    try {
      const response = await source.stopOAuthDebuggerSession(sessionId);
      setRunning(false);
      if (response.status !== 'running') {
        const next = await source.getOAuthDebuggerSession(sessionId);
        setSession(next.session);
        setViewStep('report');
      }
    } catch (error: any) {
      toast({
        title: 'Could not stop session',
        description: String(error?.message ?? error),
        variant: 'destructive'
      });
    } finally {
      setStopping(false);
    }
  };

  const exportReport = async (format: 'json' | 'markdown' | 'raw') => {
    if (!sessionId || !session) return;
    try {
      const payload = await source.exportOAuthDebuggerSession(sessionId, format);
      let content = '';
      let fileExt = format === 'json' ? 'json' : format === 'raw' ? 'txt' : 'md';
      if (typeof payload === 'string') {
        content = payload;
      } else {
        content = `${JSON.stringify(payload, null, 2)}\n`;
      }
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oauth-debugger-${sessionId}.${fileExt}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      // fallback to client markdown/json export if backend export fails
      if (format === 'markdown') {
        const content = toMarkdownClient(session, events);
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oauth-debugger-${session.id}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      toast({
        title: 'Export failed',
        description: String((error as any)?.message ?? error),
        variant: 'destructive'
      });
    }
  };

  const openAuthorizeUrl = () => {
    if (!sessionId) return;
    const launchUrl = `${oauthDebuggerApiBase()}/api/oauth-debugger/sessions/${sessionId}/authorize`;
    window.open(launchUrl, '_blank', 'noopener,noreferrer');
  };

  const severityBadge = (severity: 'error' | 'warning' | 'info') => {
    if (severity === 'error') return 'destructive' as const;
    if (severity === 'warning') return 'outline' as const;
    return 'secondary' as const;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">OAuth Debugger</h1>
          <p className="text-sm text-muted-foreground">
            Step-by-step OAuth flow debugging for MCP servers (latest MCP authorization draft profile).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STEP_LABELS.map((step) => {
            const active = viewStep === step.id;
            const allowed =
              step.id === 'configure' || (step.id === 'run' && canGoRun) || (step.id === 'report' && canGoReport);
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => allowed && setStepIfAllowed(step.id)}
                disabled={!allowed}
                className="rounded-full"
              >
                <Badge variant={active ? 'default' : 'outline'} className={!allowed ? 'opacity-50' : ''}>
                  {step.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {!loadingFlag && mode === 'workspace' && !oauthDebuggerEnabled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>OAuth Debugger is disabled</AlertTitle>
          <AlertDescription>
            Enable it in localStorage with key <code className="mx-1 rounded border px-1 py-0.5 text-xs">mcplab.feature.oauthDebugger</code>
            set to <code className="mx-1 rounded border px-1 py-0.5 text-xs">true</code>, then refresh the page.
          </AlertDescription>
        </Alert>
      )}

      {(loadingFlag || mode !== 'workspace' || oauthDebuggerEnabled) && viewStep === 'configure' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Target MCP Server</CardTitle>
                  <CardDescription>Select one MCP server from Libraries and optionally override endpoints.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void reloadLibraries()} disabled={librariesLoading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${librariesLoading ? 'animate-spin' : ''}`} />
                  Refresh Servers
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>MCP Server</Label>
                <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                  <SelectTrigger><SelectValue placeholder="Select an MCP server" /></SelectTrigger>
                  <SelectContent>
                    {servers.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name || server.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedServer && (
                  <p className="text-xs text-muted-foreground">
                    {selectedServer.transport} · {selectedServer.url || selectedServer.command || 'No URL/command'}
                  </p>
                )}
              </div>

              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Advanced endpoint overrides</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Authorization server metadata URL</Label>
                    <Input value={authorizationServerMetadataUrl} onChange={(e) => setAuthorizationServerMetadataUrl(e.target.value)} placeholder="https://.../.well-known/oauth-authorization-server" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Resource server base URL</Label>
                    <Input value={resourceBaseUrl} onChange={(e) => setResourceBaseUrl(e.target.value)} placeholder="https://resource.example.com" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Authorization endpoint</Label>
                    <Input value={authorizationEndpoint} onChange={(e) => setAuthorizationEndpoint(e.target.value)} placeholder="https://.../authorize" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Token endpoint</Label>
                    <Input value={tokenEndpoint} onChange={(e) => setTokenEndpoint(e.target.value)} placeholder="https://.../token" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Registration endpoint (DCR)</Label>
                    <Input value={registrationEndpoint} onChange={(e) => setRegistrationEndpoint(e.target.value)} placeholder="https://.../register" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">CIMD URL</Label>
                    <Input value={cimdUrl} onChange={(e) => setCimdUrl(e.target.value)} placeholder="https://.../client-metadata.json" />
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Protocol Profile</CardTitle>
              <CardDescription>
                Latest MCP OAuth draft profile is implemented in v1. Version presets are planned for older drafts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge>MCP OAuth (latest draft)</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Client Registration Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  { id: 'pre_registered', label: 'Pre-registered client' },
                  { id: 'dcr', label: 'Dynamic Client Registration (DCR)' },
                  { id: 'cimd', label: 'Client ID Metadata Document (CIMD)' }
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRegistrationMethod(option.id as RegistrationMethod)}
                    className="rounded-md border p-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${registrationMethod === option.id ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                      <span className="text-sm font-medium">{option.label}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Redirect mode</Label>
                  <Select value={redirectMode} onValueChange={(v) => setRedirectMode(v as 'local_callback' | 'manual')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local_callback">Local callback (recommended)</SelectItem>
                      <SelectItem value="manual">Manual paste redirect URL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Token endpoint auth method</Label>
                  <Input value={tokenEndpointAuthMethod} onChange={(e) => setTokenEndpointAuthMethod(e.target.value)} placeholder="client_secret_basic / none / client_secret_post" />
                </div>
              </div>

              {registrationMethod === 'pre_registered' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">client_id</Label>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">client_secret (optional)</Label>
                    <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" />
                  </div>
                </div>
              )}

              {registrationMethod === 'dcr' && (
                <div className="space-y-1">
                  <Label className="text-xs">DCR metadata JSON (optional overrides)</Label>
                  <Textarea value={dcrMetadataJson} onChange={(e) => setDcrMetadataJson(e.target.value)} className="min-h-32 font-mono text-xs" />
                </div>
              )}

              {registrationMethod === 'cimd' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">CIMD URL</Label>
                    <Input value={cimdUrl} onChange={(e) => setCimdUrl(e.target.value)} placeholder="https://.../client-metadata.json" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expected client_id (optional)</Label>
                    <Input value={expectedClientId} onChange={(e) => setExpectedClientId(e.target.value)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Runtime OAuth Inputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Scopes (space or comma separated)</Label>
                <Input value={scopesText} onChange={(e) => setScopesText(e.target.value)} placeholder="openid profile mcp" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Resource / audience (optional)</Label>
                <Input value={resource} onChange={(e) => setResource(e.target.value)} placeholder="https://resource.example.com" />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Checkbox checked={usePkce} onCheckedChange={(v) => setUsePkce(Boolean(v))} />
                <Label>Use PKCE (S256)</Label>
              </div>
            </CardContent>
          </Card>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Secrets display</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                This debugger is configured to show full tokens/secrets in network logs and exports.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox checked={!showSensitiveValues} onCheckedChange={(v) => setShowSensitiveValues(!Boolean(v))} />
                <Label>Hide sensitive values in inspector</Label>
              </div>
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button type="button" onClick={() => void createAndStart()} disabled={submitting || mode !== 'workspace'}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start OAuth Debug Session
            </Button>
          </div>
        </div>
      )}

      {viewStep === 'run' && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Card className="xl:col-span-1">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Progress</CardTitle>
                  <CardDescription>
                    Visual OAuth flow guide with live session events and next-step actions.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {session?.uiHints.authorizationUrl && (
                    <Button type="button" size="sm" variant="outline" onClick={openAuthorizeUrl}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open Authorization URL
                    </Button>
                  )}
                  {sessionId && (
                    <Button type="button" size="sm" variant="outline" onClick={() => void stopSession()} disabled={stopping || !sessionId}>
                      {(stopping || running) && stopping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <Square className="mr-2 h-4 w-4" />
                      Stop Debug Session
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{progressModel.completed + progressModel.failed}/{progressModel.total} steps</span>
                  <span>{progressModel.percent}%</span>
                </div>
                <Progress value={progressModel.percent} className="h-2" />
              </div>

              {session?.status === 'waiting_for_user' && (
                <Card>
                  <CardContent className="pt-4 space-y-2">
                    <div className="text-sm font-medium">Manual callback required</div>
                    <p className="text-xs text-muted-foreground">
                      Open the authorization URL, complete authentication, then paste the final redirect URL here.
                    </p>
                    <Textarea
                      value={manualCallbackUrl}
                      onChange={(e) => setManualCallbackUrl(e.target.value)}
                      placeholder="Paste the final redirect URL (with code and state)"
                      className="min-h-24 text-xs font-mono"
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void submitManualCallback()} disabled={submitting || !manualCallbackUrl.trim()}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Continue
                      </Button>
                      {session.uiHints.authorizationUrl && (
                        <Button type="button" size="sm" variant="outline" onClick={openAuthorizeUrl}>
                          Open Authorization URL
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {session?.status === 'waiting_for_browser_callback' && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Waiting for browser callback</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p className="text-xs">
                      Complete the authorization flow in your browser. MCP Lab is listening for the callback at:
                    </p>
                    <p className="text-xs font-mono break-all">{session.uiHints.callbackUrl}</p>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                {session?.stepStates.map((s) => (
                  <div key={s.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.description}</div>
                      </div>
                      <Badge
                        variant={
                          s.status === 'failed'
                            ? 'destructive'
                            : s.status === 'completed'
                              ? 'default'
                              : s.status === 'active'
                                ? 'secondary'
                                : 'outline'
                        }
                      >
                        {s.status}
                      </Badge>
                    </div>
                    {s.outcomeSummary && (
                      <p className="mt-2 text-xs text-muted-foreground break-all">{s.outcomeSummary}</p>
                    )}
                  </div>
                )) || (
                  <p className="text-sm text-muted-foreground">No steps yet.</p>
                )}
              </div>

              <div className="rounded-md border bg-muted/10 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Live events</div>
                <div className="max-h-48 space-y-1 overflow-auto text-xs">
                  {events.length === 0 ? (
                    <p className="text-muted-foreground">No events yet.</p>
                  ) : (
                    events.map((event, index) => (
                      <div key={`${event.ts}-${index}`} className="break-all">
                        <span className="mr-2 font-mono text-muted-foreground">
                          {new Date(event.ts).toLocaleTimeString()}
                        </span>
                        <Badge variant="outline" className="mr-2 text-[10px]">{event.type}</Badge>
                        {typeof event.payload.message === 'string'
                          ? event.payload.message
                          : JSON.stringify(event.payload)}
                      </div>
                    ))
                  )}
                  <div ref={eventsEndRef} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4 xl:col-span-1">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Inspect</CardTitle>
                <CardDescription>Network requests/responses and synchronized sequence view.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Tabs value={networkTab} onValueChange={(v) => setNetworkTab(v as 'inspector' | 'sequence')}>
                  <TabsList className="grid grid-cols-2">
                    <TabsTrigger value="inspector">Network Inspector</TabsTrigger>
                    <TabsTrigger value="sequence">Sequence Diagram</TabsTrigger>
                  </TabsList>
                  <TabsContent value="inspector" className="space-y-3 mt-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Filter by step</Label>
                        <Select value={inspectorStepFilter} onValueChange={setInspectorStepFilter}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All steps</SelectItem>
                            {(session?.stepStates ?? []).map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Filter by status</Label>
                        <Select value={inspectorStatusFilter} onValueChange={setInspectorStatusFilter}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="ok">Successful responses</SelectItem>
                            <SelectItem value="error">Error responses</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="max-h-[34rem] space-y-2 overflow-auto">
                      {filteredNetwork.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No network exchanges captured yet.</p>
                      ) : (
                        filteredNetwork.map((exchange) => (
                          <details key={exchange.id} className="rounded-md border p-3">
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">{exchange.label}</div>
                                  <div className="text-xs text-muted-foreground break-all">
                                    {exchange.method ? `${exchange.method} ` : ''}{exchange.url}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">{exchange.phase}</Badge>
                                  {typeof exchange.status === 'number' && (
                                    <Badge variant={exchange.status >= 400 ? 'destructive' : 'secondary'}>
                                      {exchange.status}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </summary>
                            <div className="mt-3 space-y-3">
                              <div>
                                <div className="mb-1 text-xs font-medium">Headers</div>
                                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(exchange.headers, null, 2)}</pre>
                              </div>
                              {exchange.bodyText && (
                                <div>
                                  <div className="mb-1 text-xs font-medium">Body</div>
                                  <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">{exchange.bodyText}</pre>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => void copyText(JSON.stringify(exchange, null, 2))}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copy JSON
                                </Button>
                              </div>
                            </div>
                          </details>
                        ))
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="sequence" className="mt-3">
                    <div className="max-h-[34rem] space-y-2 overflow-auto rounded-md border p-3">
                      {(session?.sequence ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No sequence events yet.</p>
                      ) : (
                        (session?.sequence ?? []).map((row) => (
                          <div key={row.id} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-2 rounded border p-2 text-xs">
                            <div className="text-right font-medium">{row.from}</div>
                            <div className="rounded bg-muted px-2 py-1">
                              <div className="font-medium">{row.label}</div>
                              {row.stepId && <div className="text-muted-foreground">{row.stepId}</div>}
                            </div>
                            <div className="font-medium">{row.to}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {viewStep === 'report' && session && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Report / Export</h2>
              <p className="text-sm text-muted-foreground">
                OAuth debug session summary, validations, and trace exports.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setViewStep('configure')}>
                Back to Configure
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void exportReport('json')}>
                <Download className="mr-2 h-4 w-4" />
                Export JSON
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void exportReport('markdown')}>
                <Download className="mr-2 h-4 w-4" />
                Export Markdown
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void exportReport('raw')}>
                <Download className="mr-2 h-4 w-4" />
                Copy/Export Raw Trace
              </Button>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Secrets display mode</AlertTitle>
            <AlertDescription>
              {showSensitiveValues
                ? 'This session is configured to show full tokens and secrets in network logs/exports.'
                : 'Sensitive values are hidden in the inspector for this session.'}
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Status</div><div className="text-lg font-semibold">{session.status}</div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Requests</div><div className="text-lg font-semibold">{session.networkSummary.requestCount}</div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Network errors</div><div className="text-lg font-semibold">{session.networkSummary.errorCount}</div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Validation findings</div><div className="text-lg font-semibold">{session.validations.length}</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Key values</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div><Label className="text-xs">Issuer</Label><p className="text-sm break-all">{session.summary?.issuer || '-'}</p></div>
              <div><Label className="text-xs">Client ID</Label><p className="text-sm break-all">{session.summary?.clientId || '-'}</p></div>
              <div><Label className="text-xs">Redirect URI</Label><p className="text-sm break-all">{session.summary?.redirectUri || '-'}</p></div>
              <div><Label className="text-xs">Token endpoint status</Label><p className="text-sm">{session.summary?.tokenEndpointStatus ?? '-'}</p></div>
              <div><Label className="text-xs">Token type</Label><p className="text-sm">{session.summary?.tokenType || '-'}</p></div>
              <div><Label className="text-xs">Scopes granted</Label><p className="text-sm break-all">{(session.summary?.grantedScopes ?? []).join(', ') || '-'}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Validation findings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {session.validations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No validation findings recorded.</p>
              ) : (
                session.validations.map((v, index) => (
                  <div key={v.id} className="rounded-md border p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="font-bold">{v.title}</span>
                      </div>
                      <Badge variant={severityBadge(v.severity)}>{v.severity}</Badge>
                    </div>
                    <p className="text-sm"><span className="font-bold">Finding:</span> {v.detail}</p>
                    {v.recommendation && (
                      <div className="mt-2 rounded-md border px-2.5 py-2 text-xs">
                        <div className="mb-1 font-medium text-muted-foreground">Suggested improvement</div>
                        <p>{v.recommendation}</p>
                      </div>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      Step: {v.stepId}
                      {v.specReference && (
                        <>
                          {' · '}
                          <a href={v.specReference} target="_blank" rel="noreferrer" className="text-primary underline">
                            Spec reference
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
