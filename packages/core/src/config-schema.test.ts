import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync(new URL('../../../config-schema.json', import.meta.url), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const valid = [
  { type: 'contains', tool: 'search', value: 'Paris' },
  { type: 'regex', tool: 'search', pattern: 'Par.*' },
  { type: 'jsonpath', tool: 'search', path: '$.value', equals: false },
  { type: 'jsonpath', tool: 'search', path: '$.value' }
];
const invalid = [
  { type: 'contains', tool: 'search' },
  { type: 'contains', tool: '', value: 'Paris' },
  { type: 'regex', tool: 'search', pattern: '' },
  { type: 'jsonpath', tool: 'search', path: '$.value', equals: null },
  { type: 'jsonpath', tool: 'search', path: '$.value', extra: true },
  { type: 'other', tool: 'search' }
];

describe.each(['tool_input_assertions', 'tool_output_assertions'])(
  '%s configuration schema',
  (field) => {
    it.each(valid)('accepts supported assertions', (assertion) => {
      expect(
        validate({
          agents: [],
          scenarios: [
            {
              id: 'example',
              prompt: 'Search',
              mcp_servers: [{ ref: 'server' }],
              eval: { [field]: [assertion] }
            }
          ]
        })
      ).toBe(true);
    });
    it.each(invalid)('rejects malformed assertions', (assertion) => {
      expect(
        validate({
          agents: [],
          scenarios: [
            {
              id: 'example',
              prompt: 'Search',
              mcp_servers: [{ ref: 'server' }],
              eval: { [field]: [assertion] }
            }
          ]
        })
      ).toBe(false);
    });
  }
);
