import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeView } from "../views/HomeView.js";

describe("HomeView", () => {
  it("renders the host entry point", () => {
    render(
      <MemoryRouter>
        <HomeView />
      </MemoryRouter>,
    );
    expect(screen.getByText("Quizzinator")).toBeTruthy();
    expect(screen.getByText("Host a quiz")).toBeTruthy();
  });
});
