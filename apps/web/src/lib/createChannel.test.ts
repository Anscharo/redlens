import { describe, expect, it, vi } from "vitest";
import { createChannel } from "./createChannel";

describe("createChannel", () => {
  it("delivers the payload to every subscriber", () => {
    const ch = createChannel<string>();
    const a = vi.fn();
    const b = vi.fn();
    ch.subscribe(a);
    ch.subscribe(b);
    ch.emit("x");
    expect(a).toHaveBeenCalledWith("x");
    expect(b).toHaveBeenCalledWith("x");
  });

  it("stops delivering after unsubscribe", () => {
    const ch = createChannel<number>();
    const a = vi.fn();
    const off = ch.subscribe(a);
    off();
    ch.emit(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("keeps channels independent", () => {
    const one = createChannel<number>();
    const two = createChannel<number>();
    const a = vi.fn();
    one.subscribe(a);
    two.emit(1);
    expect(a).not.toHaveBeenCalled();
  });
});
