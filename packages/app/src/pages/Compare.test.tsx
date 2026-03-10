import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Compare from "./Compare";
import type { EvalResult } from "@/types/eval";

const { sourceMock } = vi.hoisted(() => {
  const listResults = vi.fn();
  return {
    sourceMock: {
      listResults,
      listSnapshots: vi.fn().mockResolvedValue([]),
      compareSnapshot: vi.fn()
    }
  };
});

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

function makeRun(id: string, scenarios: EvalResult["scenarios"]): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: "hash",
    timestamp: "2026-03-10T10:00:00.000Z",
    mcpServerVersions: {},
    scenarios,
    overallPassRate: 1,
    totalScenarios: scenarios.length,
    totalRuns: scenarios.reduce((sum, s) => sum + s.runs.length, 0),
    avgToolCalls: 1,
    avgLatency: 100
  };
}

const baseResults: EvalResult[] = [
  makeRun("run-1", [
    {
      scenarioId: "scn-1",
      scenarioName: "Scenario 1",
      agentId: "agent-a",
      agentName: "Agent A",
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 100,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [{ name: "search", arguments: {}, duration: 100, timestamp: "2026-03-10T10:00:01.000Z" }],
          finalAnswer: "ok",
          conversation: [],
          duration: 100,
          extractedValues: {},
          failureReasons: []
        }
      ]
    },
    {
      scenarioId: "scn-1",
      scenarioName: "Scenario 1",
      agentId: "agent-b",
      agentName: "Agent B",
      passRate: 0,
      avgToolCalls: 2,
      avgDuration: 220,
      runs: [
        {
          runIndex: 0,
          passed: false,
          toolCalls: [
            { name: "search", arguments: {}, duration: 120, timestamp: "2026-03-10T10:00:02.000Z" },
            { name: "fetch", arguments: {}, duration: 100, timestamp: "2026-03-10T10:00:03.000Z" }
          ],
          finalAnswer: "failed",
          conversation: [],
          duration: 220,
          extractedValues: {},
          failureReasons: ["no match"]
        }
      ]
    }
  ]),
  makeRun("run-2", [
    {
      scenarioId: "scn-1",
      scenarioName: "Scenario 1",
      agentId: "agent-b",
      agentName: "Agent B",
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 120,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [{ name: "search", arguments: {}, duration: 120, timestamp: "2026-03-10T10:00:04.000Z" }],
          finalAnswer: "ok",
          conversation: [],
          duration: 120,
          extractedValues: {},
          failureReasons: []
        }
      ]
    },
    {
      scenarioId: "scn-2",
      scenarioName: "Scenario 2",
      agentId: "agent-a",
      agentName: "Agent A",
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 110,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [{ name: "search", arguments: {}, duration: 110, timestamp: "2026-03-10T10:00:05.000Z" }],
          finalAnswer: "ok",
          conversation: [],
          duration: 110,
          extractedValues: {},
          failureReasons: []
        }
      ]
    }
  ])
];

const mixedAgentCountResults: EvalResult[] = [
  ...baseResults,
  makeRun("run-3", [
    {
      scenarioId: "scn-3",
      scenarioName: "Scenario 3",
      agentId: "agent-solo",
      agentName: "Agent Solo",
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 80,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [{ name: "search", arguments: {}, duration: 80, timestamp: "2026-03-10T10:00:06.000Z" }],
          finalAnswer: "ok",
          conversation: [],
          duration: 80,
          extractedValues: {},
          failureReasons: []
        }
      ]
    }
  ])
];

describe("Compare", () => {
  it("switches to Within One Run mode and renders side-by-side comparison", async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Compare Runs");
    fireEvent.click(screen.getAllByRole("button", { name: "Compare agents" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Within One Run Controls")).toBeInTheDocument();
      expect(screen.getByText("Agent Summary")).toBeInTheDocument();
      expect(screen.getByText("Scenario × Agent Matrix")).toBeInTheDocument();
      expect(screen.getAllByText("Agent A").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Agent B").length).toBeGreaterThan(0);
    });
  });

  it("hydrates from URL params for within-run mode and shows sparse cells as em-dash", async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={["/compare?mode=within-run&runId=run-2&agents=agent-b,agent-a"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Scenario × Agent Matrix");
    expect(screen.getByText("Scenario 1")).toBeInTheDocument();
    expect(screen.getByText("Scenario 2")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("gracefully falls back when URL params are invalid", async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={["/compare?mode=within-run&runId=missing&agents=unknown"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Agent Summary");
    expect(screen.getByText("Scenario × Agent Matrix")).toBeInTheDocument();
  });

  it("shows Compare agents action only for runs with multiple agents", async () => {
    sourceMock.listResults.mockResolvedValue(mixedAgentCountResults);

    render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-3");
    expect(screen.getAllByRole("button", { name: "Compare agents" })).toHaveLength(2);
  });

  it("starts within-run compare directly from the run list action", async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Compare agents" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Within One Run Controls")).toBeInTheDocument();
      expect(screen.getByText("Agent Summary")).toBeInTheDocument();
      expect(screen.getByText("Scenario × Agent Matrix")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Compare full results" })).toBeInTheDocument();
    });
  });

  it("builds a side-by-side full results link for exactly two selected agents", async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Compare agents" })[0]!);

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Compare full results" });
      expect(link).toHaveAttribute(
        "href",
        "/compare/results?left=run-1&right=run-1&leftConfig=cfg-run-1&rightConfig=cfg-run-1&leftAgent=agent-a&rightAgent=agent-b"
      );
    });
  });
});
