import type { McpResourceContent, McpToolResourceCatalog } from './mcp.js';
import type { ToolDef } from './types.js';

export const MCP_LIST_RESOURCES_TOOL = 'list_resources';
export const MCP_READ_RESOURCE_TOOL = 'read_resource';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getMcpResourceToolAccess(tools: ToolDef[]) {
  const list = record(tools.find(({ name }) => name === MCP_LIST_RESOURCES_TOOL)?.inputSchema);
  const read = record(tools.find(({ name }) => name === MCP_READ_RESOURCE_TOOL)?.inputSchema);
  const properties = record(read?.properties);
  const readArgument = ['uri', 'resource_uri'].find(
    (key) =>
      read?.type === 'object' &&
      record(properties?.[key])?.type === 'string' &&
      (read.required === undefined ||
        (Array.isArray(read.required) && read.required.every((name) => name === key)))
  );
  const canList =
    list?.type === 'object' &&
    (list.required === undefined || (Array.isArray(list.required) && list.required.length === 0));
  return { canList, readArgument };
}

function unpackToolResult(result: unknown) {
  const reply = record(result);
  const values: unknown[] = Array.isArray(reply?.content) ? reply.content : [];
  const blocks = values.map(record).filter((value) => value !== undefined);
  const text = blocks.flatMap((block) =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  );
  if (reply?.isError === true)
    throw new Error(text.join('\n') || 'The server resource tool returned an error.');
  return { structured: reply?.structuredContent, blocks, text };
}

function catalogEntries(value: unknown): unknown[] | undefined {
  const payload = record(value)?.result ?? value;
  if (Array.isArray(payload)) return payload;
  const catalog = record(payload);
  if (!catalog) return undefined;
  if (
    stringField(catalog.uri) ||
    stringField(catalog.uriTemplate) ||
    stringField(catalog.uri_template)
  ) {
    return [catalog];
  }
  const resources = catalog.resources;
  const templates = catalog.resourceTemplates ?? catalog.resource_templates ?? catalog.templates;
  if (!Array.isArray(resources) && !Array.isArray(templates)) return undefined;
  return [
    ...(Array.isArray(resources) ? resources : []),
    ...(Array.isArray(templates) ? templates : [])
  ];
}

function parseCatalogText(text: string): unknown[] | undefined {
  try {
    const json = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    return catalogEntries(JSON.parse(json));
  } catch {
    return undefined;
  }
}

export function parseMcpResourceToolCatalog(result: unknown): McpToolResourceCatalog {
  const { structured, text } = unpackToolResult(result);
  let entries = catalogEntries(structured) ?? parseCatalogText(text.join('\n'));
  if (!entries && text.length > 1) {
    const chunks = text.map(parseCatalogText).filter((chunk) => chunk !== undefined);
    if (chunks.length) entries = chunks.flat();
  }
  const catalog: McpToolResourceCatalog = { resources: [], resourceTemplates: [] };
  for (const value of entries ?? []) {
    const entry = record(value);
    if (!entry) continue;
    const uri = stringField(entry.uri);
    const uriTemplate = stringField(entry.uriTemplate) ?? stringField(entry.uri_template);
    const title = stringField(entry.title);
    const description = stringField(entry.description);
    const mimeType = stringField(entry.mimeType) ?? stringField(entry.mime_type);
    const metadata = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(mimeType ? { mimeType } : {})
    };
    const name = stringField(entry.name);
    if (uri) catalog.resources.push({ ...metadata, uri, name: name ?? uri });
    else if (uriTemplate)
      catalog.resourceTemplates.push({ ...metadata, uriTemplate, name: name ?? uriTemplate });
  }
  if (
    !entries ||
    (entries.length && !catalog.resources.length && !catalog.resourceTemplates.length)
  ) {
    throw new Error('The server tool did not return recognizable resource entries.');
  }
  return catalog;
}

export function parseMcpResourceToolRead(uri: string, result: unknown): McpResourceContent[] {
  const { structured, blocks } = unpackToolResult(result);
  const contents: McpResourceContent[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      contents.push({ uri, text: block.text });
    } else if (
      (block.type === 'image' || block.type === 'audio') &&
      typeof block.data === 'string'
    ) {
      contents.push({
        uri,
        mimeType: stringField(block.mimeType),
        blobBytes: Buffer.byteLength(block.data, 'base64')
      });
    }
  }
  const structuredRecord = record(structured);
  const text = structuredRecord?.text ?? structuredRecord?.result;
  if (!contents.length && typeof text === 'string') contents.push({ uri, text });
  if (!contents.length)
    throw new Error('The server tool did not return previewable resource content.');
  return contents;
}
