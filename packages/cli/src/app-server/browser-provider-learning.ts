import { type BrowserProviderProfile, type LlmAgentConfig } from '@inspectr/mcplab-core';
import { validateBrowserProviderProfile } from '@inspectr/mcplab-core';
import type { LlmMessage } from '@inspectr/mcplab-core';
import { chatWithJsonRetry } from './assistant-common.js';

export interface BrowserProviderLearningTraceInput {
  evidenceVersion?: unknown;
  observedGeneration?: unknown;
  selectorValidation?: unknown;
  newConversationEvidence?: unknown;
  events?: unknown;
}

export interface BrowserProviderProposal {
  profile: BrowserProviderProfile;
  rationale: string[];
  warnings: string[];
  validated: true;
}

export function sanitizeBrowserProviderProposalDiagnostics(value: unknown): {
  rationale: string[];
  warnings: string[];
} {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const strings = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.slice(0, 500))
          .slice(0, 8)
      : [];
  return { rationale: strings(source.rationale), warnings: strings(source.warnings) };
}

export function sanitizeBrowserProviderLearningTrace(
  value: BrowserProviderLearningTraceInput
): Record<string, unknown> {
  const object = (candidate: unknown): Record<string, unknown> | null =>
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : null;
  const short = (candidate: unknown, limit = 200) =>
    typeof candidate === 'string' ? candidate.slice(0, limit) : undefined;
  const count = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : undefined;
  const safeLocator = (candidate: unknown) => {
    const segments = object(candidate)?.segments;
    return Array.isArray(segments) && segments.length > 0 && segments.length <= 8 &&
      segments.every((item) => typeof item === 'string')
      ? { segments: segments.map((item) => String(item).slice(0, 500)) }
      : undefined;
  };
  const safeSelectedElement = (candidate: unknown) => {
    const item = object(candidate);
    if (!item) return undefined;
    const locator = safeLocator(item.locator);
    if (!locator) return undefined;
    const attributes = object(item.attributes);
    const evaluations = object(item.selectorEvaluations);
    return {
      locator,
      selectors: Array.isArray(item.selectors)
        ? item.selectors.filter((selector): selector is string => typeof selector === 'string')
            .slice(0, 12).map((selector) => selector.slice(0, 500))
        : [],
      visible: item.visible === true,
      textLength: count(item.textLength) ?? 0,
      ...(typeof item.changedFromBaseline === 'boolean'
        ? { changedFromBaseline: item.changedFromBaseline } : {}),
      ...(typeof item.changedAfterSubmission === 'boolean'
        ? { changedAfterSubmission: item.changedAfterSubmission } : {}),
      ...(typeof item.absentAtSubmission === 'boolean'
        ? { absentAtSubmission: item.absentAtSubmission } : {}),
      ...(typeof item.candidateScore === 'number' && Number.isFinite(item.candidateScore)
        ? { candidateScore: item.candidateScore } : {}),
      ...(attributes ? {
        attributes: Object.fromEntries(
          ['role', 'ariaLabel', 'ariaBusy', 'testId', 'dataTest', 'authorRole']
            .flatMap((key) => short(attributes[key]) === undefined ? [] : [[key, short(attributes[key])]])
        )
      } : {}),
      ...(evaluations ? {
        selectorEvaluations: Object.fromEntries(
          Object.entries(evaluations).slice(0, 12).flatMap(([selector, raw]) => {
            const entry = object(raw);
            return entry ? [[selector.slice(0, 500), {
              matchCount: count(entry.matchCount) ?? 0,
              nonAssistantCount: count(entry.nonAssistantCount) ?? 0
            }]] : [];
          })
        )
      } : {})
    };
  };
  const events = Array.isArray(value.events)
    ? value.events.slice(-32).map((event) => {
        if (!event || typeof event !== 'object') return null;
        const source = event as Record<string, unknown>;
        const selected = object(source.selectedElements);
        return {
          phase: typeof source.phase === 'string' ? source.phase : undefined,
          at: typeof source.at === 'string' ? source.at : undefined,
          ...(typeof source.workingActive === 'boolean'
            ? { workingActive: source.workingActive } : {}),
          ...(selected ? {
            selectedElements: Object.fromEntries(
              ['composer', 'submit', 'assistant', 'generating', 'working', 'idle']
                .flatMap((role) => {
                  const element = safeSelectedElement(selected[role]);
                  return element ? [[role, element]] : [];
                })
            )
          } : {}),
          candidateCount:
            typeof source.candidateCount === 'number' ? source.candidateCount : undefined,
          changedCandidateCount:
            typeof source.changedCandidateCount === 'number'
              ? source.changedCandidateCount
              : undefined,
          visibleControlCount:
            typeof source.visibleControlCount === 'number' ? source.visibleControlCount : undefined,
          disabledControlCount:
            typeof source.disabledControlCount === 'number'
              ? source.disabledControlCount
              : undefined,
          selectedCandidate:
            source.selectedCandidate && typeof source.selectedCandidate === 'object'
              ? (() => {
                  const candidate = source.selectedCandidate as Record<string, unknown>;
                  return {
                    tagName: typeof candidate.tagName === 'string' ? candidate.tagName : undefined,
                    testId: typeof candidate.testId === 'string' ? candidate.testId : undefined,
                    textLength:
                      typeof candidate.textLength === 'number' ? candidate.textLength : undefined
                  };
                })()
              : undefined,
          textHash: typeof source.textHash === 'string' ? source.textHash : undefined,
          snapshot: Array.isArray(source.snapshot)
            ? source.snapshot.slice(-64).flatMap((node) => {
                if (!node || typeof node !== 'object') return [];
                const item = node as Record<string, unknown>;
                if (typeof item.selector !== 'string' || typeof item.tagName !== 'string')
                  return [];
                return [
                  {
                    selector: item.selector.slice(0, 500),
                    tagName: item.tagName.slice(0, 80),
                    ...(typeof item.role === 'string' ? { role: item.role.slice(0, 80) } : {}),
                    ...(typeof item.ariaLabel === 'string'
                      ? { ariaLabel: item.ariaLabel.slice(0, 200) }
                      : {}),
                    ...(typeof item.testId === 'string'
                      ? { testId: item.testId.slice(0, 200) }
                      : {}),
                    visible: item.visible === true,
                    disabled: item.disabled === true,
                    textLength: typeof item.textLength === 'number' ? item.textLength : 0
                  }
                ];
              })
            : undefined
        };
      })
    : [];
  return {
    ...(value.evidenceVersion === 1 ? { evidenceVersion: 1 } : {}),
    observedGeneration: value.observedGeneration === true,
    selectorValidation: Object.fromEntries(
      ['composer', 'submit', 'assistant'].flatMap((role) => {
        const entry = object(object(value.selectorValidation)?.[role]);
        return entry ? [[role, {
          valid: entry.valid === true,
          matchCount: count(entry.matchCount) ?? 0,
          visible: entry.visible === true
        }]] : [];
      })
    ),
    ...(object(value.newConversationEvidence) ? (() => {
      const evidence = object(value.newConversationEvidence)!;
      const controlLocator = safeLocator(evidence.controlLocator);
      return controlLocator &&
        ['url-changed', 'assistant-count-reduced'].includes(String(evidence.signal))
        ? { newConversationEvidence: {
            controlLocator,
            controlSelectors: Array.isArray(evidence.controlSelectors)
              ? evidence.controlSelectors.filter((selector): selector is string => typeof selector === 'string')
                  .slice(0, 12).map((selector) => selector.slice(0, 500))
              : [],
            signal: evidence.signal,
            beforeAssistantCount: count(evidence.beforeAssistantCount) ?? 0,
            afterAssistantCount: count(evidence.afterAssistantCount) ?? 0
          } }
        : {};
    })() : {}),
    events
  };
}

function validateWorkingLocatorEvidence(
  profile: BrowserProviderProfile,
  trace: BrowserProviderLearningTraceInput
): { profile: BrowserProviderProfile; warnings: string[] } {
  const events = Array.isArray(trace.events)
    ? trace.events.filter((event): event is Record<string, unknown> =>
        Boolean(event && typeof event === 'object' && !Array.isArray(event)))
    : [];
  const submittedIndex = events.findIndex((event) => event.phase === 'submitted');
  const postSubmissionEvents = events.slice(submittedIndex >= 0 ? submittedIndex + 1 : 0);
  const workingEvents = postSubmissionEvents.filter((event) => event.workingActive === true);
  const finalEvent = [...events].reverse().find((event) => event.phase === 'final');

  if (workingEvents.length === 0) {
    if (trace.observedGeneration === true && profile.completion.workingLocator) {
      throw new Error('Working locator evidence is incomplete: no active working event was observed.');
    }
    return { profile, warnings: [] };
  }
  if (!finalEvent || finalEvent.workingActive !== false) {
    throw new Error('Working locator evidence is incomplete: the final event is still active.');
  }
  if (!profile.completion.workingLocator) {
    throw new Error('Working locator evidence is incomplete: the proposal omitted the working locator.');
  }

  const proposedSegments = profile.completion.workingLocator.segments;
  const selectedWorking = workingEvents
    .map((event) => {
      const selected = event.selectedElements;
      if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return null;
      const working = (selected as Record<string, unknown>).working;
      return working && typeof working === 'object' && !Array.isArray(working)
        ? working as Record<string, unknown>
        : null;
    })
    .filter((working): working is Record<string, unknown> => working !== null);
  const observedSelectors = selectedWorking.flatMap((working) => [
    ...(Array.isArray(working.selectors)
      ? working.selectors.filter((selector): selector is string => typeof selector === 'string')
      : []),
    ...((working.locator && typeof working.locator === 'object' && !Array.isArray(working.locator)
      && Array.isArray((working.locator as Record<string, unknown>).segments))
      ? ((working.locator as Record<string, unknown>).segments as unknown[])
          .filter((segment): segment is string => typeof segment === 'string')
      : [])
  ]);
  const observed = new Set(observedSelectors);
  const proposedIsObserved = proposedSegments.every((segment) => {
    if (observed.has(segment)) return true;
    const parts = segment.match(/\[[^\]]+\]/g) ?? [];
    return parts.length > 0 && parts.every((part) =>
      observedSelectors.some((selector) => selector.includes(part))
    );
  });
  if (proposedIsObserved && !proposedSegments.some((segment) => /aria-busy\s*=/.test(segment))) {
    const transientSelector = observedSelectors.find((selector) => /aria-busy\s*=/.test(selector));
    const baseSelector = proposedSegments.find((segment) => observed.has(segment));
    if (transientSelector && baseSelector && !baseSelector.includes('aria-busy')) {
      const condition = transientSelector.match(/\[[^\]]*aria-busy\s*=\s*["'][^"']+["'][^\]]*\]/i)?.[0];
      if (condition) {
        const narrowed = `${baseSelector}${condition}`;
        return {
          profile: {
            ...profile,
            completion: {
              ...profile.completion,
              workingLocator: { segments: [narrowed] }
            }
          },
          warnings: [
            'The working locator was narrowed to preserve the observed transient aria-busy state.'
          ]
        };
      }
    }
  }
  if (!proposedIsObserved) {
    throw new Error('Working locator evidence is incomplete: the selector was not observed while working.');
  }
  return { profile, warnings: [] };
}

export function parseBrowserProviderProposal(
  text: string,
  trace?: BrowserProviderLearningTraceInput
): BrowserProviderProposal {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const rawProfile = parsed.profile ?? parsed;
  const parsedProfile = validateBrowserProviderProfile(rawProfile);
  const rationale = Array.isArray(parsed.rationale)
    ? parsed.rationale.filter((value): value is string => typeof value === 'string').slice(0, 8)
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((value): value is string => typeof value === 'string').slice(0, 8)
    : [];
  const validated = trace
    ? validateWorkingLocatorEvidence(parsedProfile, trace)
    : { profile: parsedProfile, warnings: [] };
  warnings.push(...validated.warnings);
  return { profile: validated.profile, rationale, warnings: warnings.slice(0, 8), validated: true };
}

export async function proposeBrowserProviderProfile(params: {
  agent: LlmAgentConfig;
  profile: BrowserProviderProfile;
  trace: BrowserProviderLearningTraceInput;
}): Promise<BrowserProviderProposal> {
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: [
        'Review this browser-provider learning trace and propose a corrected profile.',
        'Only change selectors or completion settings when supported by the observed lifecycle.',
        'Treat workingActive as temporal evidence. A working locator must be active after submission and inactive in the final event.',
        'Preserve transient attribute conditions such as [aria-busy="true"]. Never broaden a working locator to a persistent response container.',
        'Return one JSON object with profile, rationale (string array), and warnings (string array).',
        'Never add executable scripts, URLs outside the existing origin, or raw response content.',
        `Current profile:\n${JSON.stringify(params.profile)}`,
        `Observed trace:\n${JSON.stringify(sanitizeBrowserProviderLearningTrace(params.trace))}`
      ].join('\n\n')
    }
  ];
  const response = await chatWithJsonRetry({
    agent: params.agent,
    messages,
    tools: [],
    system:
      'You are a browser automation profile reviewer. Preserve the existing profile shape and identity. Selectors must be CSS selectors observed in the trace. A generation selector must represent an active generating state, an idle selector must represent an enabled completion state, and a working selector must describe the transient working state rather than a persistent response container.',
    parse: (text) => parseBrowserProviderProposal(text, params.trace),
    toolCallFallbackText: () => 'Return the validated browser provider profile JSON.'
  });
  if ('type' in response) throw new Error('The provider proposal model returned a tool request.');
  return response;
}
