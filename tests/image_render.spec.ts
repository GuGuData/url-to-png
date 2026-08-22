import { describe, expect, it } from "vitest";

import type { BrowserPool } from "../src/lib/browser_pool.js";
import { ImageRenderService } from "../src/lib/image_render.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createRenderer() {
  const calls: string[] = [];
  const page = {
    close: async () => calls.push("close"),
    evaluate: async () => calls.push("evaluate"),
    goto: async () => calls.push("goto"),
    screenshot: async () => {
      calls.push("screenshot");
      return ONE_PIXEL_PNG;
    },
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
  });
});
