import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioForm } from "./ScenarioForm";
import type { Scenario, AgentConfig, ServerConfig } from "@/types/eval";

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: {
      discoverToolsForAnalysis: vi.fn().mockResolvedValue({ servers: [] }),
    },
  }),
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
