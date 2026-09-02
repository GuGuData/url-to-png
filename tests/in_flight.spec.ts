import { describe, expect, it } from "vitest";

import { InFlightCoordinator } from "../src/lib/in_flight.js";

describe("InFlightCoordinator", () => {
  it("shares concurrent work for the same key", async () => {
    const coordinator = new InFlightCoordinator<string>();
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const factory = async () => {
      calls += 1;
      await gate;
      return "image";
    };

    const first = coordinator.run("same", factory);
    const second = coordinator.run("same", factory);
    release?.();

    await expect(first).resolves.toEqual({ shared: false, value: "image" });
    await expect(second).resolves.toEqual({ shared: true, value: "image" });
    expect(calls).toBe(1);
  });

  it("allows retries after a failed request", async () => {
    const coordinator = new InFlightCoordinator<string>();
    await expect(
      coordinator.run("retry", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    await expect(coordinator.run("retry", async () => "recovered")).resolves.toEqual({
      shared: false,
      value: "recovered",
    });
  });
});
