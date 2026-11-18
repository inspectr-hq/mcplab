import type { McpToolSafety, ToolDef } from './types.js';

const SIDE_EFFECT_VERB =
  'add|apply|archive|clean|cleanup|clear|commit|create|delete|destroy|disable|drop|enable|erase|execute|insert|modify|move|patch|post|publish|purge|put|remove|rename|replace|reset|revoke|run|send|set|submit|trigger|truncate|update|upload|upsert|write';
const SIDE_EFFECT_NAME = new RegExp(`(?:^|[^a-z])(?:${SIDE_EFFECT_VERB})(?:[^a-z]|$)`, 'i');
const SIDE_EFFECT_DESCRIPTION = new RegExp(
  String.raw`(?:^\s*(?:[-*]\s+)?|[.!?]\s+|\b(?:and|then|also|will|can|may|or)\s+|\b(?:use (?:this|the) tool|allows? (?:you|users?|the user)|(?:is |can be )?used) to\s+)(?:(?:this|the) (?:tool|operation)\s+|it\s+)?(?:[a-z]+ly\s+)*(?:${SIDE_EFFECT_VERB})(?:s|es)?\b`,
  'i'
);

export function classifyMcpToolSafety(
  tool: ToolDef,
  catalog?: { duplicateName: boolean; complete: boolean }
): McpToolSafety {
  const { annotations, name, description } = tool;
  if (catalog?.duplicateName) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: 'Multiple catalog entries share this tool name.'
    };
  }
  if (annotations?.destructiveHint === true) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: 'MCP annotations declare destructiveHint: true.',
      ...(annotations.readOnlyHint === true
        ? { contradictionField: 'annotations.destructiveHint' }
        : {})
    };
  }
  if (annotations?.readOnlyHint === false) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: 'MCP annotations declare readOnlyHint: false.'
    };
  }
  if (annotations?.readOnlyHint !== true) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: 'Automatic sampling requires an explicit readOnlyHint: true.'
    };
  }
  const verbs = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  let contradictionField: 'name' | 'description' | undefined;
  if (SIDE_EFFECT_NAME.test(verbs)) contradictionField = 'name';
  else if (description && SIDE_EFFECT_DESCRIPTION.test(description))
    contradictionField = 'description';
  if (contradictionField) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: `The tool ${contradictionField} indicates side effects despite readOnlyHint: true.`,
      contradictionField
    };
  }
  if (catalog && !catalog.complete) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: 'Automatic sampling requires a complete tool listing.'
    };
  }
  return {
    safetyClassification: 'read_only',
    classificationReason: 'MCP annotations declare readOnlyHint: true.'
  };
}
