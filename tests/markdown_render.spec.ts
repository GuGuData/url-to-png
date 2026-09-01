import { describe, expect, it, vi } from "vitest";

import { MarkdownRenderService } from "../src/lib/markdown_render.js";

function createBrowserFixture(options: { bodyHtml?: string; renderError?: Error } = {}) {
  const page = {
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(1),
    goto: options.renderError
      ? vi.fn().mockRejectedValue(options.renderError)
      : vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      innerHTML: vi.fn().mockResolvedValue(
        options.bodyHtml ?? "<h1>Title</h1><p>Expanded content</p><script>ignore()</script>",
      ),
    }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
  const browser = { newPage: vi.fn().mockResolvedValue(page) };
  const browserPool = {
    acquire: vi.fn().mockResolvedValue(browser),
    destroy: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };

  return { browser, browserPool, page };
}

describe("MarkdownRenderService", () => {
  it("converts expanded page content to Markdown", async () => {
    const fixture = createBrowserFixture();
    const service = new MarkdownRenderService(fixture.browserPool as never);

    const result = await service.render("https://example.com/article");

    expect(result.expandedCount).toBe(1);
    expect(result.markdown).toContain("# Title");
    expect(result.markdown).toContain("Expanded content");
    expect(result.markdown).not.toContain("ignore()");
    expect(fixture.browserPool.release).toHaveBeenCalledWith(fixture.browser);
    expect(fixture.browserPool.destroy).not.toHaveBeenCalled();
    expect(fixture.page.close).toHaveBeenCalledOnce();
  });

  it("destroys a browser after a rendering failure", async () => {
    const fixture = createBrowserFixture({ renderError: new Error("navigation failed") });
    const service = new MarkdownRenderService(fixture.browserPool as never);

    await expect(service.render("https://example.com/article")).rejects.toThrow("navigation failed");

    expect(fixture.browserPool.destroy).toHaveBeenCalledWith(fixture.browser);
    expect(fixture.browserPool.release).not.toHaveBeenCalled();
    expect(fixture.page.close).toHaveBeenCalledOnce();
  });

  it("replaces an incomplete browser session when expansion is required", async () => {
    const incomplete = createBrowserFixture({ bodyHtml: "<p>Short content</p>" });
    incomplete.page.evaluate.mockResolvedValue(0);
    const complete = createBrowserFixture({ bodyHtml: "<h1>Title</h1><p>Expanded content</p>" });
    const browserPool = {
      acquire: vi
        .fn()
        .mockResolvedValueOnce(incomplete.browser)
        .mockResolvedValueOnce(complete.browser),
      destroy: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MarkdownRenderService(browserPool as never);

    const result = await service.render("https://example.com/article", true);

    expect(result.expandedCount).toBe(1);
    expect(result.markdown).toContain("Expanded content");
    expect(browserPool.destroy).toHaveBeenCalledWith(incomplete.browser);
    expect(browserPool.release).toHaveBeenCalledWith(complete.browser);
  });
});
