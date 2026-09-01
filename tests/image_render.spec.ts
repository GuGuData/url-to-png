import { errors as playwrightErrors } from "playwright";
import { describe, expect, it } from "vitest";

import type { BrowserPool } from "../src/lib/browser_pool.js";
import { ImageRenderService } from "../src/lib/image_render.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createRenderer(goto?: () => Promise<void>, screenshot?: () => Promise<Buffer>) {
  const calls: string[] = [];
  const page = {
    close: async () => calls.push("close"),
    evaluate: async () => calls.push("evaluate"),
    goto: goto ?? (async () => calls.push("goto")),
    waitForTimeout: async () => calls.push("waitForTimeout"),
    screenshot:
      screenshot ??
      (async () => {
        calls.push("screenshot");
        return ONE_PIXEL_PNG;
      }),
  };
  const browser = {
    newPage: async () => {
      calls.push("newPage");
      return page;
    },
  };
  const browserPool = {
    acquire: async () => {
      calls.push("acquire");
      return browser;
    },
    destroy: async () => calls.push("destroy"),
    release: async () => calls.push("release"),
  } as unknown as BrowserPool;

  return {
    calls,
    renderer: new ImageRenderService(browserPool),
  };
}

describe("ImageRenderService", () => {
  it("prepares scrollable content before a full-page screenshot", async () => {
    const { calls, renderer } = createRenderer();

    await renderer.screenshot("https://example.com", {
      isFullPage: true,
      viewportHeight: 900,
      viewportWidth: 1440,
    });

    expect(calls).toStrictEqual([
      "acquire",
      "newPage",
      "goto",
      "evaluate",
      "screenshot",
      "close",
      "release",
    ]);
  });

  it("does not alter the page for a viewport screenshot", async () => {
    const { calls, renderer } = createRenderer();

    await renderer.screenshot("https://example.com", {
      isFullPage: false,
      viewportHeight: 900,
      viewportWidth: 1440,
    });

    expect(calls).not.toContain("evaluate");
    expect(calls.indexOf("goto")).toBeLessThan(calls.indexOf("screenshot"));
    expect(calls).toContain("waitForTimeout");
  });

  it("captures a best-effort image after a navigation timeout", async () => {
    let timedOut = false;
    const { calls, renderer } = createRenderer(async () => {
      timedOut = true;
      throw new playwrightErrors.TimeoutError("navigation timed out");
    });

    const image = await renderer.screenshot("https://example.com", {
      isFullPage: false,
      viewportHeight: 900,
      viewportWidth: 1440,
    });

    expect(image.byteLength).toBeGreaterThan(0);
    expect(timedOut).toBe(true);
    expect(calls).toContain("screenshot");
  });

  it("destroys a browser after a rendering failure", async () => {
    const { calls, renderer } = createRenderer(undefined, async () => {
      calls.push("screenshot");
      throw new Error("render failed");
    });

    await expect(
      renderer.screenshot("https://example.com", {
        isFullPage: false,
        viewportHeight: 900,
        viewportWidth: 1440,
      }),
    ).rejects.toThrow("render failed");

    expect(calls).toContain("destroy");
    expect(calls).not.toContain("release");
  });
});
