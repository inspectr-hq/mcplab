import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { McpCatalogList } from './mcp.js';
import type {
  McpCatalogCheck,
  McpErrorIndicator,
  McpHealthCheck,
  McpHealthFinding,
  McpHealthReport,
  ToolAnalysisServerReport,
  ToolAnalysisToolReport,
  ToolDef
} from './types.js';

const SLOW_PHASE_MS = 3000;
const CHECK_ORDER = { fail: 0, warning: 1, pass: 2, skipped: 3 } as const;
const CREDENTIAL =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:bearer\s+[\w.~-]{12,}|AKIA[A-Z0-9]{16}|(?:gh[pousr]_|sk-)[\w-]{16,})\b|[a-z][\w+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const CREDENTIAL_FIELD =
  /\b(?:password|secret|api[_ -]?key|access[_ -]?token|authorization)\b["']?\s*[:=]\s*(?:(["'])([^"']{8,})\1|([^\s,"'}]{20,}))/gi;
const INTERNAL_DETAILS =
  /\bat\s+[^\n]+\.(?:[cm]?[jt]sx?|py):\d+(?::\d+)?\b|traceback \(most recent call last\)|\b(?:stack trace|stacktrace)\b|(?:^|[\s("'\\])(?:\/(?:srv|home|Users|var|app)\/|[A-Z]:\\(?:Users|Program Files)\\)[^\s)"']+/im;

const INDICATOR_MESSAGES: Record<McpErrorIndicator, string> = {
  credential: 'An error response appears to contain a credential.',
  internal_details: 'An error response appears to expose a stack trace or internal file path.'
};

function hasCredentialField(text: string): boolean {
  for (const match of text.matchAll(CREDENTIAL_FIELD)) {
    if (match[2]) return true;
    const value = match[3];
    if (!value) continue;
    const frequencies = new Map<string, number>();
    for (const char of value) frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
    const entropy = [...frequencies.values()].reduce(
      (sum, count) => sum - (count / value.length) * Math.log2(count / value.length),
      0
    );
    if (value.length >= 24 || (frequencies.size >= 8 && entropy >= 3.5)) return true;
  }
  return false;
}

export function inspectMcpError(text: string): {
  error: string;
  errorIndicators: McpErrorIndicator[];
} {
  const errorIndicators: McpErrorIndicator[] = [];
  if (CREDENTIAL.test(text) || hasCredentialField(text)) errorIndicators.push('credential');
  if (INTERNAL_DETAILS.test(text)) errorIndicators.push('internal_details');
  return {
    error: errorIndicators.length
      ? errorIndicators.map((indicator) => INDICATOR_MESSAGES[indicator]).join(' ')
      : text.replace(/\s+/g, ' ').trim().slice(0, 300),
    errorIndicators
  };
}

export function makeMcpInputChecker(
  schema: unknown
): ((args: unknown) => 'valid' | 'invalid' | undefined) | undefined {
  if (typeof schema !== 'object' || !schema || Array.isArray(schema)) return undefined;
  try {
    const validate = new AjvJsonSchemaValidator().getValidator(schema);
    return (args) => {
      try {
        return validate(args).valid ? 'valid' : 'invalid';
      } catch {
        return undefined;
      }
    };
  } catch {
    return undefined;
  }
}

function safeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

type HealthInput = {
  tools?: McpCatalogList<ToolDef>;
  recordedToolCount?: number;
  catalogChecks: McpCatalogCheck[];
  connection?: { ok: boolean; durationMs: number; message?: string };
  listingMs?: number;
  endpoint?: string;
  implementation?: McpHealthReport['implementation'];
  protocolVersion?: string;
  toolReports: ToolAnalysisToolReport[];
  samplingEnabled?: boolean;
};

export function buildMcpHealthReport(input: HealthInput): McpHealthReport {
  const { tools, catalogChecks, connection, listingMs, protocolVersion, toolReports } = input;
  const checks: McpHealthCheck[] = [];
  const list = catalogChecks.find(({ kind }) => kind === 'tools');
  const items = tools && 'items' in tools ? tools.items : [];
  const toolCount = input.recordedToolCount ?? new Set(items.map(({ name }) => name)).size;
  const partialListing =
    tools?.status === 'partial' || (!tools && list?.status === 'warning' && Boolean(list.message));
  const timings: McpHealthReport['timings'] = {
    connectMs: connection?.durationMs,
    listMs: listingMs
  };
  const add = (
    id: string,
    title: string,
    status: McpHealthCheck['status'],
    detail: string,
    findings?: McpHealthFinding[]
  ) => checks.push({ id, title, status, detail, ...(findings?.length ? { findings } : {}) });

  if (connection) {
    add(
      'connection',
      'Connects to the server',
      connection.ok ? 'pass' : 'fail',
      connection.ok ? 'The MCP connection completed.' : (connection.message ?? 'Connection failed.')
    );
  } else
    add('connection', 'Connects to the server', 'skipped', 'No connection attempt was recorded.');

  if (protocolVersion) {
    const current = protocolVersion === LATEST_PROTOCOL_VERSION;
    add(
      'protocol',
      'MCP protocol negotiation',
      current ? 'pass' : 'warning',
      current
        ? `Negotiated ${protocolVersion}, the newest revision supported by this MCPLab client.`
        : `Negotiated ${protocolVersion}. This MCPLab client supports ${LATEST_PROTOCOL_VERSION}.`
    );
  } else
    add(
      'protocol',
      'MCP protocol negotiation',
      'skipped',
      'No negotiated protocol version was recorded.'
    );

  const definitionFindings = list?.findings.filter(({ code }) => code === undefined) ?? [];
  let listStatus: McpHealthCheck['status'] = 'pass';
  if (
    connection?.ok === false ||
    tools?.status === 'unsupported' ||
    (!tools && (!list || list.status === 'skipped'))
  ) {
    listStatus = 'skipped';
  } else if (
    tools?.status === 'error' ||
    list?.status === 'fail' ||
    definitionFindings.some(({ status }) => status === 'fail')
  ) {
    listStatus = 'fail';
  } else if (partialListing || definitionFindings.length > 0) {
    listStatus = 'warning';
  }
  let listDetail = `${toolCount} tools listed.`;
  if (listStatus === 'skipped') {
    listDetail = 'No tool listing was recorded.';
    if (connection?.ok === false) listDetail = 'Connection unavailable.';
    else if (tools?.status === 'unsupported') listDetail = 'The server does not advertise tools.';
  } else if (list?.message) listDetail = list.message;
  add('listing', 'Lists valid tool definitions', listStatus, listDetail, definitionFindings);

  const toolMetadataAvailable = (list?.itemsChecked ?? items.length) > 0;
  const descriptions = list?.findings.filter(({ code }) => code === 'description') ?? [];
  const descriptionFindings = descriptions.map((finding) =>
    finding.path === '/description' ? { ...finding, status: 'fail' as const } : finding
  );
  const descriptionStatus = descriptionFindings.some(({ status }) => status === 'fail')
    ? 'fail'
    : 'warning';
  add(
    'description',
    'Tool and input descriptions',
    toolMetadataAvailable ? (descriptions.length ? descriptionStatus : 'pass') : 'skipped',
    toolMetadataAvailable
      ? descriptions.length
        ? `${descriptions.length} missing descriptions.`
        : 'Listed tools and inputs have descriptions.'
      : 'No tool definitions were available.',
    descriptionFindings
  );

  const safetyFindings = list?.findings.filter(({ code }) => code === 'safety') ?? [];
  add(
    'safety',
    'Tool safety annotations',
    toolMetadataAvailable ? (safetyFindings.length ? 'warning' : 'pass') : 'skipped',
    toolMetadataAvailable
      ? safetyFindings.length
        ? `${safetyFindings.length} absent or contradictory safety signals.`
        : 'Listed tool annotations passed the safety checks.'
      : 'No tool definitions were available.',
    safetyFindings
  );

  const otherCatalogs = catalogChecks.filter(
    ({ kind, status }) => kind !== 'tools' && kind !== 'tool_resources' && status !== 'skipped'
  );
  const catalogFindings: McpHealthFinding[] = otherCatalogs.flatMap(
    ({ kind, status, message, findings }) => {
      const result: McpHealthFinding[] = findings.filter(({ code }) => code !== 'instruction');
      if (message && (status === 'fail' || status === 'warning'))
        result.push({ status, item: kind, message });
      return result;
    }
  );
  let catalogStatus: McpHealthCheck['status'] = otherCatalogs.length ? 'pass' : 'skipped';
  if (catalogFindings.length)
    catalogStatus = catalogFindings.some(({ status }) => status === 'fail') ? 'fail' : 'warning';
  add(
    'catalog',
    'Resource, prompt, and skill catalogs',
    catalogStatus,
    otherCatalogs.length
      ? `Inspected ${otherCatalogs.length} native catalog sections.`
      : 'No native catalog sections were inspected.',
    catalogFindings
  );

  const instructions = catalogChecks.flatMap(({ findings }) =>
    findings.filter(({ code }) => code === 'instruction')
  );
  const metadataAvailable = catalogChecks.some(({ itemsChecked }) => itemsChecked > 0);
  add(
    'instructions',
    'Instruction-like metadata',
    metadataAvailable ? (instructions.length ? 'warning' : 'pass') : 'skipped',
    metadataAvailable
      ? instructions.length
        ? `${instructions.length} instruction or formatting signals matched.`
        : 'No known patterns matched the inspected metadata.'
      : 'No catalog metadata was available.',
    instructions
  );

  const samples = toolReports.flatMap((tool) =>
    (tool.deeperAnalysis?.sampleCalls ?? [])
      .filter(({ outcome, durationMs }) => outcome !== undefined || durationMs !== undefined)
      .map((sample) => ({ item: tool.toolName, sample }))
  );
  const toolsRun = new Set(samples.map(({ item }) => item)).size;
  const normalSamples = samples.filter(({ sample }) => sample.inputSchemaStatus !== 'invalid');
  const runtimeFindings: McpHealthFinding[] = normalSamples
    .filter(({ sample }) => !sample.ok)
    .map(({ item, sample }) => ({
      item,
      status: 'fail',
      message: sample.error ? inspectMcpError(sample.error).error : 'Sample call failed.'
    }));
  if (input.samplingEnabled) {
    for (const tool of toolReports) {
      const analysis = tool.deeperAnalysis;
      if (analysis?.attempted === false)
        runtimeFindings.push({
          item: tool.toolName,
          status: 'skipped',
          message: analysis.skippedReason ?? 'Sampling was skipped.'
        });
    }
  }
  const successCount = normalSamples.filter(({ sample }) => sample.ok).length;
  add(
    'samples',
    'Sampled tool calls',
    normalSamples.length ? (successCount === normalSamples.length ? 'pass' : 'fail') : 'skipped',
    normalSamples.length
      ? `${successCount} of ${normalSamples.length} sample calls succeeded.`
      : 'No ordinary sample calls ran.',
    runtimeFindings
  );

  const invalidSamples = samples.filter(({ sample }) => sample.inputSchemaStatus === 'invalid');
  const invalidFindings: McpHealthFinding[] = invalidSamples.flatMap(({ item, sample }) => {
    if (sample.outcome === 'tool_error') return [];
    if (sample.outcome === 'success')
      return [
        {
          item,
          status: 'warning',
          message: 'Accepted a sample that did not match the declared input schema.'
        }
      ];
    return [
      {
        item,
        status:
          sample.outcome === 'timeout' || sample.outcome === 'transport_error' ? 'fail' : 'warning',
        message: sample.error ?? 'The invalid input did not receive a tool error.'
      }
    ];
  });
  let invalidStatus: McpHealthCheck['status'] = invalidSamples.length ? 'pass' : 'skipped';
  if (invalidFindings.length)
    invalidStatus = invalidFindings.some(({ status }) => status === 'fail') ? 'fail' : 'warning';
  add(
    'bad_inputs',
    'Invalid input handling',
    invalidStatus,
    invalidSamples.length
      ? `Observed ${invalidSamples.length} sampled inputs that did not match their declared schema.`
      : 'No schema-invalid sample inputs were observed.',
    invalidFindings
  );

  const callTimes = samples.flatMap(({ sample }) =>
    sample.durationMs === undefined ? [] : [sample.durationMs]
  );
  if (callTimes.length)
    timings.averageCallMs = Math.round(
      callTimes.reduce((sum, ms) => sum + ms, 0) / callTimes.length
    );
  const measured =
    connection?.ok !== false
      ? [
          timings.connectMs,
          tools?.status === 'ready' ? timings.listMs : undefined,
          timings.averageCallMs
        ].filter((ms) => ms !== undefined)
      : [];
  const slow = measured.some((ms) => ms > SLOW_PHASE_MS);
  add(
    'latency',
    'Response times',
    measured.length ? (slow ? 'warning' : 'pass') : 'skipped',
    measured.length
      ? slow
        ? 'A measured phase exceeded 3 seconds.'
        : 'Measured phases finished within 3 seconds.'
      : 'No successful phases were available to grade.'
  );

  const errors = samples.filter(({ sample }) => sample.errorIndicators !== undefined);
  const errorFindings: McpHealthFinding[] = errors.flatMap(({ item, sample }) =>
    (sample.errorIndicators ?? []).map((indicator) => ({
      item,
      status: indicator === 'credential' ? 'fail' : 'warning',
      message: INDICATOR_MESSAGES[indicator]
    }))
  );
  let errorStatus: McpHealthCheck['status'] = errors.length ? 'pass' : 'skipped';
  if (errorFindings.length)
    errorStatus = errorFindings.some(({ status }) => status === 'fail') ? 'fail' : 'warning';
  add(
    'errors',
    'Sensitive details in tool errors',
    errorStatus,
    errors.length
      ? `Scanned ${errors.length} observed tool errors for common credential and internal-detail patterns.`
      : 'No observed tool errors were available to scan.',
    errorFindings
  );

  const tested = checks.filter(({ status }) => status !== 'skipped');
  const points = tested.reduce(
    (sum, { status }) => sum + (status === 'pass' ? 1 : status === 'warning' ? 0.5 : 0),
    0
  );
  const endpoint = safeEndpoint(input.endpoint);
  return {
    endpoint,
    implementation: input.implementation,
    protocolVersion,
    transport: connection?.ok ? 'streamable-http' : undefined,
    score: tested.length ? Math.round((100 * points) / tested.length) : null,
    checkedCount: tested.length,
    toolsRun,
    toolCount,
    ...(partialListing ? { partialListing: true } : {}),
    timings,
    checks: checks.sort((first, second) => CHECK_ORDER[first.status] - CHECK_ORDER[second.status])
  };
}

export function buildSavedMcpHealthReport(
  server: ToolAnalysisServerReport,
  version?: string | null,
  samplingEnabled?: boolean
): McpHealthReport {
  const catalogChecks = (server.catalogChecks ?? []).map((check) => ({
    ...check,
    findings: check.findings.map((finding) => {
      if (finding.code) return finding;
      // Reports written before finding codes used these fixed checker messages.
      let code: (typeof check.findings)[number]['code'];
      if (
        finding.message ===
        'Metadata contains instruction-like text or hidden formatting characters.'
      ) {
        code = 'instruction';
      } else if (/^(?:Input field |Argument )?description is missing\.$/i.test(finding.message)) {
        code = 'description';
      } else if (
        finding.path.startsWith('/annotations') ||
        finding.message.includes('indicates side effects despite readOnlyHint')
      ) {
        code = 'safety';
      }
      return code ? { ...finding, code } : finding;
    })
  }));
  return buildMcpHealthReport({
    catalogChecks,
    recordedToolCount: server.toolCountDiscovered,
    implementation: version ? { name: server.serverName, version } : undefined,
    toolReports: server.tools,
    samplingEnabled
  });
}
