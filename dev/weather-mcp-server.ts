#!/usr/bin/env node
/**
 * Weather MCP Server – demo server for MCPLab screenshots.
 * Runs on http://localhost:3300/mcp (HTTP SSE transport).
 * Usage: tsx dev/weather-mcp-server.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const PORT = Number(process.env.MCP_PORT ?? 3300);
const HOST = process.env.MCP_HOST ?? '127.0.0.1';
const MCP_PATH = '/mcp';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface CurrentWeather {
  location: string;
  country: string;
  lat: number;
  lon: number;
  temp_c: number;
  feels_like_c: number;
  humidity: number;
  wind_kph: number;
  wind_dir: string;
  condition: string;
  condition_code: string;
  visibility_km: number;
  uv_index: number;
  pressure_mb: number;
  updated_at: string;
}

interface ForecastDay {
  date: string;
  max_c: number;
  min_c: number;
  condition: string;
  condition_code: string;
  chance_of_rain: number;
  total_precip_mm: number;
  sunrise: string;
  sunset: string;
}

interface WeatherAlert {
  headline: string;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  event: string;
  effective: string;
  expires: string;
  description: string;
}

const CITIES: Record<string, CurrentWeather> = {
  amsterdam: {
    location: 'Amsterdam', country: 'Netherlands', lat: 52.37, lon: 4.89,
    temp_c: 12, feels_like_c: 9, humidity: 82, wind_kph: 22, wind_dir: 'SW',
    condition: 'Overcast with light rain', condition_code: 'rainy',
    visibility_km: 8, uv_index: 1, pressure_mb: 1008,
    updated_at: new Date().toISOString(),
  },
  london: {
    location: 'London', country: 'United Kingdom', lat: 51.51, lon: -0.13,
    temp_c: 9, feels_like_c: 6, humidity: 88, wind_kph: 18, wind_dir: 'W',
    condition: 'Foggy', condition_code: 'foggy',
    visibility_km: 3, uv_index: 1, pressure_mb: 1011,
    updated_at: new Date().toISOString(),
  },
  'new york': {
    location: 'New York', country: 'United States', lat: 40.71, lon: -74.01,
    temp_c: 7, feels_like_c: 4, humidity: 65, wind_kph: 28, wind_dir: 'NW',
    condition: 'Partly cloudy', condition_code: 'partly_cloudy',
    visibility_km: 16, uv_index: 2, pressure_mb: 1021,
    updated_at: new Date().toISOString(),
  },
  tokyo: {
    location: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69,
    temp_c: 18, feels_like_c: 17, humidity: 55, wind_kph: 12, wind_dir: 'E',
    condition: 'Mostly clear', condition_code: 'mostly_clear',
    visibility_km: 20, uv_index: 4, pressure_mb: 1018,
    updated_at: new Date().toISOString(),
  },
  sydney: {
    location: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21,
    temp_c: 26, feels_like_c: 27, humidity: 70, wind_kph: 15, wind_dir: 'NE',
    condition: 'Sunny', condition_code: 'sunny',
    visibility_km: 25, uv_index: 8, pressure_mb: 1015,
    updated_at: new Date().toISOString(),
  },
  paris: {
    location: 'Paris', country: 'France', lat: 48.85, lon: 2.35,
    temp_c: 11, feels_like_c: 8, humidity: 78, wind_kph: 20, wind_dir: 'SW',
    condition: 'Light rain', condition_code: 'rainy',
    visibility_km: 10, uv_index: 1, pressure_mb: 1009,
    updated_at: new Date().toISOString(),
  },
  berlin: {
    location: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.41,
    temp_c: 2, feels_like_c: -2, humidity: 90, wind_kph: 16, wind_dir: 'N',
    condition: 'Light snow', condition_code: 'snowy',
    visibility_km: 5, uv_index: 1, pressure_mb: 1005,
    updated_at: new Date().toISOString(),
  },
  singapore: {
    location: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82,
    temp_c: 31, feels_like_c: 38, humidity: 88, wind_kph: 10, wind_dir: 'S',
    condition: 'Thunderstorms', condition_code: 'thunderstorm',
    visibility_km: 6, uv_index: 6, pressure_mb: 1007,
    updated_at: new Date().toISOString(),
  },
  dubai: {
    location: 'Dubai', country: 'United Arab Emirates', lat: 25.20, lon: 55.27,
    temp_c: 28, feels_like_c: 30, humidity: 48, wind_kph: 14, wind_dir: 'NW',
    condition: 'Clear', condition_code: 'clear',
    visibility_km: 30, uv_index: 9, pressure_mb: 1013,
    updated_at: new Date().toISOString(),
  },
  'san francisco': {
    location: 'San Francisco', country: 'United States', lat: 37.77, lon: -122.42,
    temp_c: 15, feels_like_c: 12, humidity: 72, wind_kph: 32, wind_dir: 'W',
    condition: 'Windy with patchy clouds', condition_code: 'windy',
    visibility_km: 18, uv_index: 3, pressure_mb: 1016,
    updated_at: new Date().toISOString(),
  },
};

const FORECASTS: Record<string, ForecastDay[]> = {
  amsterdam: [
    { date: offsetDate(0), max_c: 13, min_c: 8, condition: 'Rainy', condition_code: 'rainy', chance_of_rain: 85, total_precip_mm: 6.2, sunrise: '07:42', sunset: '18:15' },
    { date: offsetDate(1), max_c: 11, min_c: 7, condition: 'Overcast', condition_code: 'cloudy', chance_of_rain: 60, total_precip_mm: 2.4, sunrise: '07:40', sunset: '18:17' },
    { date: offsetDate(2), max_c: 14, min_c: 9, condition: 'Partly cloudy', condition_code: 'partly_cloudy', chance_of_rain: 30, total_precip_mm: 0.8, sunrise: '07:38', sunset: '18:19' },
    { date: offsetDate(3), max_c: 16, min_c: 10, condition: 'Sunny intervals', condition_code: 'partly_cloudy', chance_of_rain: 15, total_precip_mm: 0.0, sunrise: '07:36', sunset: '18:21' },
    { date: offsetDate(4), max_c: 15, min_c: 9, condition: 'Cloudy', condition_code: 'cloudy', chance_of_rain: 40, total_precip_mm: 1.2, sunrise: '07:34', sunset: '18:23' },
  ],
  london: [
    { date: offsetDate(0), max_c: 10, min_c: 6, condition: 'Foggy', condition_code: 'foggy', chance_of_rain: 50, total_precip_mm: 1.0, sunrise: '07:15', sunset: '18:05' },
    { date: offsetDate(1), max_c: 12, min_c: 7, condition: 'Cloudy', condition_code: 'cloudy', chance_of_rain: 45, total_precip_mm: 0.6, sunrise: '07:13', sunset: '18:07' },
    { date: offsetDate(2), max_c: 13, min_c: 8, condition: 'Partly sunny', condition_code: 'partly_cloudy', chance_of_rain: 20, total_precip_mm: 0.0, sunrise: '07:11', sunset: '18:09' },
    { date: offsetDate(3), max_c: 11, min_c: 6, condition: 'Light rain', condition_code: 'rainy', chance_of_rain: 70, total_precip_mm: 3.4, sunrise: '07:09', sunset: '18:11' },
    { date: offsetDate(4), max_c: 10, min_c: 5, condition: 'Heavy rain', condition_code: 'rainy', chance_of_rain: 90, total_precip_mm: 8.1, sunrise: '07:07', sunset: '18:13' },
  ],
  berlin: [
    { date: offsetDate(0), max_c: 3, min_c: -1, condition: 'Snow showers', condition_code: 'snowy', chance_of_rain: 70, total_precip_mm: 4.5, sunrise: '07:52', sunset: '17:55' },
    { date: offsetDate(1), max_c: 1, min_c: -3, condition: 'Heavy snow', condition_code: 'snowy', chance_of_rain: 85, total_precip_mm: 9.2, sunrise: '07:50', sunset: '17:57' },
    { date: offsetDate(2), max_c: 4, min_c: 0, condition: 'Sleet', condition_code: 'sleet', chance_of_rain: 60, total_precip_mm: 3.1, sunrise: '07:48', sunset: '17:59' },
    { date: offsetDate(3), max_c: 6, min_c: 1, condition: 'Overcast', condition_code: 'cloudy', chance_of_rain: 30, total_precip_mm: 0.4, sunrise: '07:46', sunset: '18:01' },
    { date: offsetDate(4), max_c: 8, min_c: 2, condition: 'Partly cloudy', condition_code: 'partly_cloudy', chance_of_rain: 20, total_precip_mm: 0.0, sunrise: '07:44', sunset: '18:03' },
  ],
};

const ALERTS: Record<string, WeatherAlert[]> = {
  berlin: [
    {
      headline: 'Winter Storm Warning',
      severity: 'severe',
      event: 'Winter Storm',
      effective: new Date().toISOString(),
      expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      description: 'Heavy snowfall expected. Total snow accumulations of 15–25 cm. Travel is strongly discouraged. If you must travel, keep an extra flashlight, food, and water in your vehicle.',
    },
  ],
  singapore: [
    {
      headline: 'Thunderstorm Advisory',
      severity: 'moderate',
      event: 'Thunderstorm',
      effective: new Date().toISOString(),
      expires: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      description: 'Isolated thunderstorms with gusty winds and heavy rain likely during the afternoon and early evening. Lightning hazard exists.',
    },
  ],
};

function offsetDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function resolveCity(location: string): string | null {
  const key = location.toLowerCase().trim();
  if (CITIES[key]) return key;
  // fuzzy: starts-with
  const match = Object.keys(CITIES).find((k) => k.startsWith(key) || key.startsWith(k));
  return match ?? null;
}

function defaultForecast(city: CurrentWeather): ForecastDay[] {
  return Array.from({ length: 5 }, (_, i) => ({
    date: offsetDate(i),
    max_c: city.temp_c + 2,
    min_c: city.temp_c - 3,
    condition: city.condition,
    condition_code: city.condition_code,
    chance_of_rain: city.humidity > 80 ? 60 : 20,
    total_precip_mm: city.humidity > 80 ? 3.5 : 0.2,
    sunrise: '06:30',
    sunset: '19:00',
  }));
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createWeatherServer(): McpServer {
  const server = new McpServer({
    name: 'weather-mcp-server',
    version: '1.0.0',
  });

  // Tool: get_current_weather
  server.tool(
    'get_current_weather',
    'Get the current weather conditions for a city.',
    { location: z.string().describe('City name, e.g. "Amsterdam", "New York", "Tokyo"') },
    async ({ location }) => {
      const key = resolveCity(location);
      if (!key) {
        return {
          content: [{ type: 'text', text: `Location "${location}" not found. Try: ${Object.values(CITIES).map((c) => c.location).join(', ')}.` }],
          isError: true,
        };
      }
      const w = CITIES[key];
      const text = [
        `## Current Weather – ${w.location}, ${w.country}`,
        '',
        `**Condition:** ${w.condition}`,
        `**Temperature:** ${w.temp_c}°C (feels like ${w.feels_like_c}°C)`,
        `**Humidity:** ${w.humidity}%`,
        `**Wind:** ${w.wind_kph} km/h ${w.wind_dir}`,
        `**Visibility:** ${w.visibility_km} km`,
        `**Pressure:** ${w.pressure_mb} mb`,
        `**UV Index:** ${w.uv_index}`,
        `**Coordinates:** ${w.lat}, ${w.lon}`,
        `**Updated:** ${w.updated_at}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  // Tool: get_forecast
  server.tool(
    'get_forecast',
    'Get a multi-day weather forecast for a city.',
    {
      location: z.string().describe('City name'),
      days: z.number().int().min(1).max(7).default(5).describe('Number of days (1–7)'),
    },
    async ({ location, days }) => {
      const key = resolveCity(location);
      if (!key) {
        return {
          content: [{ type: 'text', text: `Location "${location}" not found.` }],
          isError: true,
        };
      }
      const city = CITIES[key];
      const forecast = (FORECASTS[key] ?? defaultForecast(city)).slice(0, days);
      const rows = forecast.map((d) =>
        `| ${d.date} | ${d.condition} | ${d.max_c}°C / ${d.min_c}°C | ${d.chance_of_rain}% rain | ${d.total_precip_mm} mm | ${d.sunrise} → ${d.sunset} |`
      );
      const text = [
        `## ${days}-Day Forecast – ${city.location}, ${city.country}`,
        '',
        '| Date | Condition | High / Low | Rain Chance | Precip | Daylight |',
        '|------|-----------|-----------|-------------|--------|----------|',
        ...rows,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  // Tool: get_weather_alerts
  server.tool(
    'get_weather_alerts',
    'Get active weather alerts and warnings for a city.',
    { location: z.string().describe('City name') },
    async ({ location }) => {
      const key = resolveCity(location);
      if (!key) {
        return {
          content: [{ type: 'text', text: `Location "${location}" not found.` }],
          isError: true,
        };
      }
      const city = CITIES[key];
      const alerts = ALERTS[key] ?? [];
      if (alerts.length === 0) {
        return {
          content: [{ type: 'text', text: `✅ No active weather alerts for ${city.location}.` }],
        };
      }
      const parts = alerts.map((a) =>
        [
          `### ⚠️ ${a.headline}`,
          `**Severity:** ${a.severity.toUpperCase()}  |  **Event:** ${a.event}`,
          `**Effective:** ${a.effective}`,
          `**Expires:** ${a.expires}`,
          '',
          a.description,
        ].join('\n')
      );
      const text = [`## Active Weather Alerts – ${city.location}`, '', ...parts].join('\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  // Tool: search_locations
  server.tool(
    'search_locations',
    'Search for available locations supported by this weather server.',
    { query: z.string().describe('Partial city name to search for') },
    async ({ query }) => {
      const q = query.toLowerCase().trim();
      const matches = Object.values(CITIES).filter(
        (c) => c.location.toLowerCase().includes(q) || c.country.toLowerCase().includes(q)
      );
      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No locations found matching "${query}".` }],
        };
      }
      const rows = matches.map(
        (c) => `| ${c.location} | ${c.country} | ${c.lat}, ${c.lon} |`
      );
      const text = [
        `## Locations matching "${query}"`,
        '',
        '| City | Country | Coordinates |',
        '|------|---------|-------------|',
        ...rows,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server with stateful session management
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(text));
  res.end(text);
}

type SessionEntry = { transport: StreamableHTTPServerTransport; server: McpServer };
const sessions = new Map<string, SessionEntry>();

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/' && req.method === 'GET') {
    sendJson(res, 200, {
      name: 'weather-mcp-server',
      description: 'Demo weather MCP server for MCPLab screenshots',
      transport: 'streamable-http',
      mcp_endpoint: MCP_PATH,
      available_locations: Object.values(CITIES).map((c) => `${c.location}, ${c.country}`),
    });
    return;
  }

  if (url.pathname !== MCP_PATH) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  // Session handling
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request: invalid JSON');
      return;
    }

    // New session on initialize
    if (!sessionId && isInitializeRequest(parsed)) {
      const id = randomUUID();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id });
      const server = createWeatherServer();
      sessions.set(id, { transport, server });
      transport.onclose = () => sessions.delete(id);
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      return;
    }

    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sendJson(res, 400, { error: 'Unknown or missing session id' });
      return;
    }
    await session.transport.handleRequest(req, res, parsed);
    return;
  }

  if (req.method === 'GET') {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sendJson(res, 400, { error: 'Unknown or missing session id' });
      return;
    }
    await session.transport.handleRequest(req, res);
    return;
  }

  if (req.method === 'DELETE') {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) {
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId!);
    } else {
      res.statusCode = 204;
      res.end();
    }
    return;
  }

  res.statusCode = 405;
  res.end('Method Not Allowed');
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[weather-mcp-server] listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.log(`[weather-mcp-server] available locations: ${Object.values(CITIES).map((c) => c.location).join(', ')}`);
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
