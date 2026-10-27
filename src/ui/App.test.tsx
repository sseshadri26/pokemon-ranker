/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";

describe("Favordex duel controls", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("picks, ties, skips, undoes, and swipes", () => {
    render(<App />);
    const count = () => screen.getByTestId("matchup-count").textContent;
    expect(count()).toContain("0 matchups");

    fireEvent.click(screen.getByTestId("pick-a"));
    expect(count()).toContain("1 matchup");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(count()).toContain("2 matchups");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(count()).toContain("3 matchups");

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(count()).toContain("3 matchups");

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(count()).toContain("3 matchups");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(count()).toContain("2 matchups");

    class TestPointerEvent extends window.MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "touch";
      }
    }
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
    const stage = screen.getByTestId("stage");
    fireEvent.pointerDown(stage, { clientX: 40, clientY: 80, pointerId: 1, button: 0, pointerType: "touch" });
    fireEvent.pointerMove(stage, { clientX: 140, clientY: 84, pointerId: 1, button: 0, pointerType: "touch" });
    fireEvent.pointerUp(stage, { clientX: 160, clientY: 88, pointerId: 1, button: 0, pointerType: "touch" });
    expect(count()).toContain("3 matchups");
  });

  it("filters the rankings by name and type", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Rankings" }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Bulbasaur" } });
    expect(screen.getByText("Bulbasaur")).toBeTruthy();
    expect(screen.queryByText("Charmander")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "fire" } });
    expect(screen.getByText("Charmander")).toBeTruthy();
    expect(screen.queryByText("Bulbasaur")).toBeNull();
    expect(screen.getByText(/Showing/)).toBeTruthy();
  });
});
