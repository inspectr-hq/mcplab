import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import RunEvaluation from "./RunEvaluation";

const {
  configReloadMock,
  librariesReloadMock,
  sourceMock,
  emptyConfigs,
  emptyServers,
  emptyAgents,
  emptyScenarios,
} = vi.hoisted(() => {
  const getRunQueue = vi.fn().mockResolvedValue({ active: null, queued: [] });
  const emptyConfigs: [] = [];
  const emptyServers: [] = [];
  const emptyAgents: [] = [];
  const emptyScenarios: [] = [];
  return {
    configReloadMock: vi.fn(),
    librariesReloadMock: vi.fn(),
    emptyConfigs,
    emptyServers,
    emptyAgents,
    emptyScenarios,
    sourceMock: {
      getRunQueue,
      subscribeRunJob: vi.fn(() => () => {}),
      stopRun: vi.fn(),
      removeQueuedRun: vi.fn(),
      startRun: vi.fn(),
      createSnapshotFromRun: vi.fn(),
    },
  };
});

vi.mock("@/contexts/DataSourceContext", () => ({
  useDataSource: () => ({
    source: sourceMock,
  }),
}));

vi.mock("@/contexts/ConfigContext", () => ({
  useConfigs: () => ({
    configs: emptyConfigs,
    loading: false,
    getConfig: () => undefined,
    addConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    cloneConfig: vi.fn(),
    reload: configReloadMock,
  }),
}));

vi.mock("@/contexts/LibraryContext", () => ({
  useLibraries: () => ({
    servers: emptyServers,
    agents: emptyAgents,
    scenarios: emptyScenarios,
    loading: false,
    setServers: vi.fn(),
    setAgents: vi.fn(),
    setScenarios: vi.fn(),
    reload: librariesReloadMock,
  }),
}));

describe("RunEvaluation", () => {
  it("reloads configs and libraries when refresh is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/run"]}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(configReloadMock).toHaveBeenCalled();
    });

    const initialConfigCalls = configReloadMock.mock.calls.length;
    const initialLibraryCalls = librariesReloadMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh configs" }));

    await waitFor(() => {
      expect(configReloadMock).toHaveBeenCalledTimes(initialConfigCalls + 1);
      expect(librariesReloadMock).toHaveBeenCalledTimes(initialLibraryCalls + 1);
    });
  });
});
