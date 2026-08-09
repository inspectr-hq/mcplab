import { describe, expect, it } from 'vitest';
import {
  normalizeCopilotEvalRules,
  validateCopilotExtractRules
} from './global-copilot-validation';

describe('global Copilot draft validation', () => {
  it('normalizes supported check aliases', () => {
    expect(
      normalizeCopilotEvalRules([{ type: 'required_tool', tool: 'mcplab_list_library' }])
    ).toEqual([{ type: 'required_tool', value: 'mcplab_list_library' }]);
  });

  it('rejects unsupported checks and malformed extraction rules', () => {
    expect(() => normalizeCopilotEvalRules([{ type: 'unknown' }])).toThrow('unsupported rule type');
    expect(() => validateCopilotExtractRules([{ name: 'route' }])).toThrow('name and pattern');
  });
});
