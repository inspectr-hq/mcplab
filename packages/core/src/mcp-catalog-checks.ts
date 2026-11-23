import type { McpCatalogList, McpServerCatalog } from './mcp.js';
import { discoverMcpCatalogSkills } from './mcp-skill-catalog.js';
import { classifyMcpToolSafety } from './mcp-tool-safety.js';
import type {
  McpCatalogCheck,
  McpCatalogCheckFinding,
  McpCatalogCheckSummary,
  ToolDef
} from './types.js';

type Finding = Omit<McpCatalogCheckFinding, 'item'>;
type AddFinding = (
  status: Finding['status'],
  path: string,
  message: string,
  code?: Finding['code']
) => void;
type Metadata = { title?: string; description?: string };

const UNSUPPORTED = { status: 'unsupported' } as const;
const SCHEMA_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SCHEMA_ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_CHILDREN = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties'
];
const INSTRUCTION_PATTERN =
  /\b(?:ignore|override|disregard)\b.{0,48}\b(?:instructions|rules|system prompt)\b|\b(?:do not|don't|never) tell the user\b|<\s*important\b|[\u200B\u202A-\u202E\u2066-\u2069]/i;
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function duplicateMcpIdentifiers(ids: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function inspectText(value: string | undefined, path: string, add: AddFinding) {
  if (value && INSTRUCTION_PATTERN.test(value)) {
    add(
      'warning',
      path,
      /<\s*important\b/i.test(value)
        ? 'An IMPORTANT block appears in metadata.'
        : 'Metadata contains instruction-like text or hidden formatting characters.',
      'instruction'
    );
  }
}

function inspectMetadata(item: Metadata, add: AddFinding) {
  if (!item.description?.trim())
    add('warning', '/description', 'Description is missing.', 'description');
  inspectText(item.title, '/title', add);
  inspectText(item.description, '/description', add);
}

function pointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectToolSchema(value: unknown, path: string, add: AddFinding) {
  if (!isRecord(value) || value.type !== 'object') {
    add('fail', path, 'Expected a JSON Schema with an object at the root for this MCP client.');
    return;
  }
  const pending: Array<{ schema: unknown; path: string }> = [{ schema: value, path }];
  while (pending.length) {
    const current = pending.pop()!;
    const node = current.schema;
    if (typeof node === 'boolean') continue;
    if (!isRecord(node)) {
      add('fail', current.path, 'Expected a JSON Schema object or boolean.');
      continue;
    }
    const { type, required, description } = node;
    if (type !== undefined) {
      const types = Array.isArray(type) ? type : [type];
      const valid =
        types.length > 0 &&
        new Set(types).size === types.length &&
        types.every((entry) => typeof entry === 'string' && SCHEMA_TYPES.has(entry));
      if (!valid) add('fail', current.path + '/type', 'Invalid JSON Schema type.');
    }
    if (
      required !== undefined &&
      (!Array.isArray(required) ||
        new Set(required).size !== required.length ||
        required.some((entry) => typeof entry !== 'string'))
    ) {
      add('fail', current.path + '/required', 'Expected an array of unique field names.');
    }
    if (typeof description === 'string')
      inspectText(description, current.path + '/description', add);
    else if (description !== undefined) {
      add('fail', current.path + '/description', 'Expected a string description.');
    }
    for (const keyword of ['minimum', 'maximum', 'multipleOf']) {
      const bound = node[keyword];
      if (
        bound !== undefined &&
        (typeof bound !== 'number' ||
          !Number.isFinite(bound) ||
          (keyword === 'multipleOf' && bound <= 0))
      ) {
        add('fail', current.path + '/' + keyword, 'Expected a valid numeric constraint.');
      }
    }
    for (const keyword of SCHEMA_MAPS) {
      const map = node[keyword];
      if (map === undefined) continue;
      const mapPath = current.path + '/' + keyword;
      if (!isRecord(map)) {
        add('fail', mapPath, 'Expected an object containing field schemas.');
        continue;
      }
      for (const [name, schema] of Object.entries(map)) {
        const field = mapPath + '/' + pointerPart(name);
        if (
          path === '/inputSchema' &&
          current.path === path &&
          keyword === 'properties' &&
          isRecord(schema) &&
          typeof schema.$ref !== 'string' &&
          (typeof schema.description !== 'string' || !schema.description.trim())
        ) {
          add(
            'warning',
            field + '/description',
            'Input field description is missing.',
            'description'
          );
        }
        pending.push({ schema, path: field });
      }
    }
    for (const keyword of SCHEMA_CHILDREN) {
      const schema = node[keyword];
      if (schema === undefined || (keyword === 'items' && Array.isArray(schema))) continue;
      pending.push({ schema, path: current.path + '/' + keyword });
    }
    // Earlier drafts use an array-valued items keyword for tuples.
    const arrayKeywords = Array.isArray(node.items) ? [...SCHEMA_ARRAYS, 'items'] : SCHEMA_ARRAYS;
    for (const keyword of arrayKeywords) {
      const children = node[keyword];
      if (children === undefined) continue;
      const childrenPath = current.path + '/' + keyword;
      if (!Array.isArray(children) || children.length === 0) {
        add('fail', childrenPath, 'Expected a non-empty array of schemas.');
        continue;
      }
      for (const [index, schema] of children.entries()) {
        pending.push({ schema, path: childrenPath + '/' + index });
      }
    }
  }
}

function inspectTool(tool: ToolDef, add: AddFinding) {
  if (!/^[a-z0-9_.-]{1,128}$/i.test(tool.name)) {
    add('warning', '/name', 'Tool name falls outside the MCP naming recommendations.');
  }
  inspectToolSchema(tool.inputSchema, '/inputSchema', add);
  if (tool.outputSchema !== undefined) inspectToolSchema(tool.outputSchema, '/outputSchema', add);
  const { contradictionField, classificationReason } = classifyMcpToolSafety(tool);
  if (contradictionField) {
    add('warning', '/' + contradictionField.replace('.', '/'), classificationReason, 'safety');
  }
  if (
    tool.annotations?.readOnlyHint === undefined &&
    tool.annotations?.destructiveHint === undefined
  ) {
    add(
      'warning',
      '/annotations',
      'Tool does not declare read-only or destructive behavior.',
      'safety'
    );
  }
}

function checkSection<T extends Metadata>(
  kind: McpCatalogCheck['kind'],
  list: McpCatalogList<T>,
  idField: keyof T & string,
  inspect?: (item: T, add: AddFinding) => void
): McpCatalogCheck {
  if (list.status === 'unsupported') {
    return {
      kind,
      status: 'skipped',
      itemsChecked: 0,
      findings: [],
      message: 'Capability not advertised.'
    };
  }
  if (list.status === 'error') {
    return { kind, status: 'fail', itemsChecked: 0, findings: [], message: list.message };
  }
  const findings: McpCatalogCheckFinding[] = [];
  const ids = list.items.map((item) => String(item[idField] ?? ''));
  const duplicates = duplicateMcpIdentifiers(ids);
  for (const [index, item] of list.items.entries()) {
    const id = ids[index];
    const add: AddFinding = (status, path, message, code) =>
      findings.push({
        status,
        path,
        message,
        item: id || 'Entry ' + (index + 1),
        ...(code ? { code } : {})
      });
    const idPath = '/' + idField;
    if (!id.trim()) add('fail', idPath, 'Identifier is missing.');
    if (duplicates.delete(id)) add('fail', idPath, 'Duplicate identifier.');
    inspectMetadata(item, add);
    inspect?.(item, add);
  }
  let status: McpCatalogCheck['status'] = 'pass';
  if (list.status === 'partial' || findings.length > 0) status = 'warning';
  if (findings.some((finding) => finding.status === 'fail')) status = 'fail';
  return {
    kind,
    status,
    itemsChecked: list.items.length,
    findings,
    ...(list.status === 'partial' ? { message: list.message } : {})
  };
}

export function checkMcpCatalog(
  tools: McpCatalogList<ToolDef>,
  catalog?: McpServerCatalog
): McpCatalogCheck[] {
  const checks = [checkSection('tools', tools, 'name', inspectTool)];
  if (!catalog) return checks;

  checks.push(
    checkSection('resources', catalog.resources, 'uri', (resource, add) => {
      if (!URI_SCHEME.test(resource.uri) || /\s/.test(resource.uri)) {
        add('fail', '/uri', 'Expected a URI with a scheme and no whitespace.');
      }
      if (!resource.name?.trim()) add('fail', '/name', 'Resource name is missing.');
    }),
    checkSection(
      'resource_templates',
      catalog.resourceTemplates,
      'uriTemplate',
      (template, add) => {
        const uri = template.uriTemplate.replace(/\{[^{}\s]+\}/g, 'value');
        if (!URI_SCHEME.test(uri) || /[{}\s]/.test(uri)) {
          add(
            'fail',
            '/uriTemplate',
            'Expected a URI template with a scheme and balanced expressions.'
          );
        }
        if (!template.name?.trim()) add('fail', '/name', 'Resource template name is missing.');
      }
    ),
    checkSection('prompts', catalog.prompts, 'name', (prompt, add) => {
      const args = prompt.arguments ?? [];
      const duplicates = duplicateMcpIdentifiers(args.map((argument) => argument.name));
      for (const [index, argument] of args.entries()) {
        const path = '/arguments/' + index;
        if (!argument.name.trim()) add('fail', path + '/name', 'Argument name is missing.');
        if (duplicates.delete(argument.name))
          add('fail', path + '/name', 'Duplicate argument name.');
        if (!argument.description?.trim())
          add('warning', path + '/description', 'Argument description is missing.', 'description');
        inspectText(argument.description, path + '/description', add);
      }
    })
  );
  const { resources } = catalog;
  const nativeSkills =
    'items' in resources
      ? { ...resources, items: discoverMcpCatalogSkills({ ...catalog, toolResources: undefined }) }
      : UNSUPPORTED;
  const skills = checkSection('skills', nativeSkills, 'path');
  if (resources.status === 'error') skills.message = 'Native resources could not be listed.';
  checks.push(skills);
  if (catalog.toolResources) {
    checks.push({
      kind: 'tool_resources',
      status: 'skipped',
      itemsChecked: 0,
      message: 'Listing tool-backed resources and skills requires executing a tool.',
      findings: []
    });
  }
  return checks;
}

export function summarizeMcpCatalogChecks(checks: McpCatalogCheck[]): McpCatalogCheckSummary {
  const statusCounts = { pass: 0, warning: 0, fail: 0, skipped: 0 };
  let itemsChecked = 0;
  for (const check of checks) {
    statusCounts[check.status] += 1;
    itemsChecked += check.itemsChecked;
  }
  return { itemsChecked, statusCounts };
}
