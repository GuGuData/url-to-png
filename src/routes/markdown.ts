import { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { AppEnv } from "../app.js";
import { logger } from "../lib/logger.js";
import { MarkdownRenderInterface } from "../lib/markdown_render.js";

export function getMarkdown(markdownRenderService: MarkdownRenderInterface) {
  return async (c: Context<AppEnv>) => {
    const { url } = c.get("input");
    const requireExpansion = c.req.query("requireExpansion") === "true";
    const startedAt = Date.now();
    const hostname = new URL(url).hostname;

    try {
      const result = await markdownRenderService.render(url, requireExpansion);
      logger.info(
        {
          characters: result.markdown.length,
          durationMs: Date.now() - startedAt,
          expandedCount: result.expandedCount,
          hostname,
        },
        "Markdown rendered",
      );
      return c.json(result);
    } catch (error) {
      logger.error(
        {
          durationMs: Date.now() - startedAt,
          errorName: error instanceof Error ? error.name : "UnknownError",
          hostname,
        },
        "Markdown rendering failed",
      );
      c.header("Retry-After", "2");
      throw new HTTPException(503, { message: "Markdown service is temporarily unavailable" });
    }
  };
}
