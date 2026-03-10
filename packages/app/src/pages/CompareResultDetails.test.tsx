import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import CompareResultDetails from "./CompareResultDetails";

describe("CompareResultDetails", () => {
  it("shows guidance when required query params are missing", async () => {
    render(
      <MemoryRouter initialEntries={["/compare/results"]}>
        <Routes>
          <Route path="/compare/results" element={<CompareResultDetails />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Full Result Compare")).toBeInTheDocument();
    expect(screen.getByText(/Select exactly two runs in Compare/)).toBeInTheDocument();
  });

  it("renders side-by-side iframes with optional agent filters", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/compare/results?left=run-1&right=run-1&leftConfig=cfg-1&rightConfig=cfg-1&leftAgent=agent-a&rightAgent=agent-b"
        ]}
      >
        <Routes>
          <Route path="/compare/results" element={<CompareResultDetails />} />
        </Routes>
      </MemoryRouter>
    );

    const leftFrame = screen.getByTitle("Result run-1 · agent-a");
    const rightFrame = screen.getByTitle("Result run-1 · agent-b");
    expect(leftFrame).toHaveAttribute("src", "/results/run-1?configId=cfg-1&agent=agent-a&embed=1");
    expect(rightFrame).toHaveAttribute("src", "/results/run-1?configId=cfg-1&agent=agent-b&embed=1");

    expect(screen.getByRole("link", { name: "Open Left" })).toHaveAttribute(
      "href",
      "/results/run-1?configId=cfg-1&agent=agent-a"
    );
    expect(screen.getByRole("link", { name: "Open Right" })).toHaveAttribute(
      "href",
      "/results/run-1?configId=cfg-1&agent=agent-b"
    );
  });
});
