import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioForm } from "./ScenarioForm";
import type { Scenario, AgentConfig, ServerConfig } from "@/types/eval";

const mockSource = {
  discoverToolsForAnalysis: vi.fn().mockResolvedValue({ servers: [] }),
  getOAuthRuntimeSession: vi.fn(),
  createOAuthRuntimeSession: vi.fn(),
};
const mockWaitForOAuthRuntimeSession = vi.fn();

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: mockSource,
  }),
}));

vi.mock("@/lib/oauth-runtime-utils", () => ({
  waitForOAuthRuntimeSession: (...args: unknown[]) => mockWaitForOAuthRuntimeSession(...args),
}));

vi.mock("@/components/config-editor/ScenarioAssistantDialog", () => ({
  ScenarioAssistantDialog: () => null,
}));

function baseScenario(): Scenario {
  return {
    id: "scn-1",
    name: "Scenario 1",
    serverIds: [],
    prompt: "test prompt",
    evalRules: [],
    extractRules: [],
  };
}

describe("ScenarioForm checks editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSource.discoverToolsForAnalysis.mockResolvedValue({ servers: [] });
    mockSource.getOAuthRuntimeSession.mockRejectedValue(new Error("missing"));
    mockSource.createOAuthRuntimeSession.mockResolvedValue({
      session: {
        id: "oauthrt-1",
        authorizeLaunchUrl: "https://auth.example.com",
        authorizationUrl: "https://auth.example.com",
      },
    });
    mockWaitForOAuthRuntimeSession.mockResolvedValue(undefined);
  });

  it("loads tools with OAuth runtime sessions for oauth2 servers", async () => {
    mockSource.discoverToolsForAnalysis.mockResolvedValue({ servers: [{ tools: [] }] });
    vi.spyOn(window, "open").mockImplementation(() => null);

    const onChange = vi.fn();
    render(
      <ScenarioForm
        scenarios={[{ ...baseScenario(), serverIds: ["oauth-server"] }]}
        agents={[] as AgentConfig[]}
        servers={[
          {
            id: "oauth-server",
            name: "OAuth Server",
            transport: "streamable-http",
            url: "https://example.com/mcp",
            authType: "oauth2",
          },
        ] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Load tools" }));

    await waitFor(() =>
      expect(mockSource.createOAuthRuntimeSession).toHaveBeenCalledWith({ serverName: "oauth-server" })
    );
    await waitFor(() =>
      expect(mockSource.discoverToolsForAnalysis).toHaveBeenCalledWith({
        serverNames: ["oauth-server"],
        oauthRuntimeSessions: { "oauth-server": "oauthrt-1" },
      })
    );
  });

  it("adds response_equals checks with literal value", async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByText("Text equals"));
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "success" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([{ type: "response_equals", value: "success" }]);
  });

  it("adds response_jsonpath checks with optional equals", async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByText("JSONPath (optional equals)"));
    fireEvent.change(screen.getByPlaceholderText("JSONPath (e.g. $.status)"), {
      target: { value: "$.status" },
    });
    fireEvent.change(screen.getByPlaceholderText("Equals (optional)"), {
      target: { value: "active" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      { type: "response_jsonpath", path: "$.status", equals: "active" },
    ]);
  });
});
