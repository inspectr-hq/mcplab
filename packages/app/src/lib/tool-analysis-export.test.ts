import { describe, expect, it } from 'vitest';
import { buildToolInfoExport, buildToolInfoFilename } from './tool-analysis-export';

describe('buildToolInfoExport', () => {
  it('exports compact tool info without analysis-only fields', () => {
    const exportData = buildToolInfoExport({
      serverName: 'demo',
      tools: [
        {
          name: 'get_weather',
          title: 'Weather Information Provider',
          description: 'Get current weather information for a location',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City name or zip code'
              }
            },
            required: ['location']
          },
          outputSchema: {
            type: 'object',
            properties: {
              temperature: {
                type: 'number'
              }
            }
          },
          safetyClassification: 'read_only',
          classificationReason: 'read prefix'
        }
      ]
    });

    expect(exportData).toEqual({
      serverName: 'demo',
      tools: [
        {
          name: 'get_weather',
          title: 'Weather Information Provider',
          description: 'Get current weather information for a location',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City name or zip code'
              }
            },
            required: ['location']
          },
          outputSchema: {
            type: 'object',
            properties: {
              temperature: {
                type: 'number'
              }
            }
          }
        }
      ]
    });
  });

  it('includes the MCP server version in the filename when available', () => {
    expect(buildToolInfoFilename('trendminer', '1.2.3')).toBe('tool-info-trendminer-v1.2.3.json');
  });

  it('omits the version from the filename when unavailable', () => {
    expect(buildToolInfoFilename('trendminer')).toBe('tool-info-trendminer.json');
  });
});
