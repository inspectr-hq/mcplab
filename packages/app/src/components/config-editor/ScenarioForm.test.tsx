import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioForm } from "./ScenarioForm";
import type { Scenario, AgentConfig, ServerConfig } from "@/types/eval";

const mockSource = {
  discoverToolsForAnalysis: vi.fn().mockResolvedValue({ servers: [] }),
};
const mockEnsureOAuthForServers = vi.fn();

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: mockSource,
  }),
}));

vi.mock("@/lib/oauth-session-utils", () => ({
  ensureOAuthForServers: (...args: unknown[]) => mockEnsureOAuthForServers(...args),
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
    mockEnsureOAuthForServers.mockResolvedValue(undefined);
  });

  it("loads tools after ensuring OAuth for oauth2 servers", async () => {
    mockSource.discoverToolsForAnalysis.mockResolvedValue({ servers: [{ tools: [] }] });

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
      expect(mockEnsureOAuthForServers).toHaveBeenCalledWith({
        serverNames: ["oauth-server"],
        source: mockSource,
      })
    );
    await waitFor(() =>
      expect(mockSource.discoverToolsForAnalysis).toHaveBeenCalledWith({
        serverNames: ["oauth-server"],
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
