export function isScenarioAssistantHandoffRelevant(
  reply: string,
  hasScenarioContext: boolean
): boolean {
  if (!hasScenarioContext) return false;
  const text = String(reply ?? '').toLowerCase();
  if (!text.trim()) return false;

  const editSignals = [
    'check',
    'checks',
    'rule',
    'rules',
    'regex',
    'pattern',
    'value capture',
    'extract rule',
    'update',
    'change',
    'replace',
    'modify',
    'adjust',
    'use ',
    'set '
  ];
  const concreteSuggestionSignals = [
    'change ',
    'replace ',
    'update ',
    'use ',
    'set the',
    'suggested',
    'you should',
    'try ',
    'text match failed',
    'text must match pattern'
  ];
  const explanationOnlySignals = [
    'i can only read',
    "i don't have write access",
    'i cannot directly edit',
    'what happened',
    'summary'
  ];

  if (
    explanationOnlySignals.some((s) => text.includes(s)) &&
    !concreteSuggestionSignals.some((s) => text.includes(s))
  ) {
    return false;
  }

  const hasEditSignal = editSignals.some((s) => text.includes(s));
  const hasConcreteSuggestion = concreteSuggestionSignals.some((s) => text.includes(s));
  const hasListStructure = /(^|\n)\s*[-*]\s+/.test(reply) || /(^|\n)\s*\d+\.\s+/.test(reply);
  const hasQuotedPattern = /["'`][^"'`\n]{2,}["'`]/.test(reply);

  return hasEditSignal && (hasConcreteSuggestion || hasListStructure || hasQuotedPattern);
}
