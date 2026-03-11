import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Results from "./Results";
import type { EvalResult } from "@/types/eval";

const { sourceMock } = vi.hoisted(() => {
  const listResults = vi.fn();
  const deleteResult = vi.fn();
  return {
    sourceMock: {
      listResults,
      deleteResult
    }
  };
});

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

function makeRun(id: string, tokenTotal: number | null): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: "hash",
    timestamp: "2026-03-10T10:00:00.000Z",
    mcpServerVersions: {},
    scenarios: [
      {
        scenarioId: "scn-1",
        scenarioName: "Scenario 1",
        agentId: "agent-1",
        agentName: "Agent 1",
        runs: [],
        passRate: 1,
        avgToolCalls: 0,
        avgDuration: 0
      }
    ],
    overallPassRate: 1,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 1,
    avgLatency: 100,
    toolTokenUsage:
      tokenTotal === null
        ? null
        : {
            inputTokens: Math.floor(tokenTotal / 2),
            outputTokens: tokenTotal - Math.floor(tokenTotal / 2),
            totalTokens: tokenTotal
          }
  };
}

describe("Results", () => {
  it("renders tool token totals and n/a when unavailable", async () => {
    sourceMock.listResults.mockResolvedValue([makeRun("run-a", 1200), makeRun("run-b", null)]);

    render(
      <MemoryRouter initialEntries={["/results"]}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Results");
    expect(screen.getByRole("columnheader", { name: /Tool Tokens/i })).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });

  it("sorts tool tokens with null values always last", async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRun("run-low", 100),
      makeRun("run-high", 900),
      makeRun("run-null", null)
    ]);

    render(
      <MemoryRouter initialEntries={["/results"]}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-low");
    const sortButton = screen.getByRole("button", { name: /Tool Tokens/i });

    fireEvent.click(sortButton);
    await waitFor(() => {
      const runLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/results/run-"));
      expect(runLinks.map((link) => link.textContent)).toEqual(["run-low", "run-high", "run-null"]);
    });

    fireEvent.click(sortButton);
    await waitFor(() => {
      const runLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/results/run-"));
      expect(runLinks.map((link) => link.textContent)).toEqual(["run-high", "run-low", "run-null"]);
    });
  });
});
