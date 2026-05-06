import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function makeRun(id: string, tokenTotal: number | null, timestamp = "2026-03-10T10:00:00.000Z"): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: "hash",
    timestamp,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the global MCP Lab Assistant sidebar from the Results header", async () => {
    sourceMock.listResults.mockResolvedValue([makeRun("run-a", 1200)]);

    render(
      <MemoryRouter initialEntries={["/results"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Results");
    fireEvent.click(screen.getByRole("button", { name: "MCP Lab Assistant" }));
    expect(screen.getByPlaceholderText("Ask about historical run differences...")).toBeInTheDocument();
  });

  it("toggles MCP Lab Assistant expand mode in results", async () => {
    sourceMock.listResults.mockResolvedValue([makeRun("run-a", 1200)]);

    render(
      <MemoryRouter initialEntries={["/results"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Results");
    fireEvent.click(screen.getByRole("button", { name: "MCP Lab Assistant" }));
    const expandButton = screen.getByRole("button", { name: /Expand/i });
    fireEvent.click(expandButton);
    expect(screen.getByRole("button", { name: /Compact/i })).toBeInTheDocument();
  });

  it("renders tool token totals and n/a when unavailable", async () => {
    sourceMock.listResults.mockResolvedValue([makeRun("run-a", 1200), makeRun("run-b", null)]);

    render(
      <MemoryRouter initialEntries={["/results"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
      <MemoryRouter initialEntries={["/results"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

  it("filters runs by the Last 15min preset", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-10T10:15:00.000Z").getTime());
    sourceMock.listResults.mockResolvedValue([
      makeRun("run-fresh", 1200, "2026-03-10T10:10:00.000Z"),
      makeRun("run-old", 900, "2026-03-10T09:30:00.000Z")
    ]);

    render(
      <MemoryRouter
        initialEntries={["/results?time_filter=last&time_preset=15min"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-fresh");
    await waitFor(() => {
      expect(screen.getByText("Last 15min")).toBeInTheDocument();
      const runLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/results/run-"));
      expect(runLinks.map((link) => link.textContent)).toEqual(["run-fresh"]);
    });
  });

  it("filters runs by a custom date time range", async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRun("run-inside", 1200, "2026-03-10T10:10:00.000Z"),
      makeRun("run-outside", 900, "2026-03-10T09:30:00.000Z")
    ]);

    render(
      <MemoryRouter
        initialEntries={["/results?time_filter=custom&time_start=2026-03-10T11:00&time_end=2026-03-10T11:15"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("run-inside");
    fireEvent.click(screen.getAllByRole("combobox")[1]!);

    await waitFor(() => {
      expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-03-10T11:00");
      expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2026-03-10T11:15");
      const runLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/results/run-"));
      expect(runLinks.map((link) => link.textContent)).toEqual(["run-inside"]);
    });
  });
});
