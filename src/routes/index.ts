import { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { AppEnv } from "../app.js";
import { ImageRenderInterface } from "../lib/image_render.js";
import { logger } from "../lib/logger.js";

import { ImageStorage } from "../lib/storage/_base.js";

export function getIndex(
  imageStorageService: ImageStorage,
  imageRenderService: ImageRenderInterface,
) {
  return async (c: Context<AppEnv>) => {
    const { url, ...input } = c.get("input");
    const imageId = c.get("imageId");
    const startedAt = Date.now();
    const hostname = new URL(url).hostname;

    let imageBuffer: Buffer | null = await imageStorageService.fetchImage(imageId);
    const cacheHit = imageBuffer !== null;

    if (imageBuffer === null || input.forceReload) {
      try {
        imageBuffer = await imageRenderService.screenshot(url, input);
      } catch (err: any) {
        logger.error(
          {
            durationMs: Date.now() - startedAt,
            errorName: err instanceof Error ? err.name : "UnknownError",
            hostname,
          },
          "Screenshot rendering failed",
        );
        c.header("Retry-After", "2");
        throw new HTTPException(503, { message: "Screenshot service is temporarily unavailable" });
      }

      try {
        await imageStorageService.storeImage(imageId, imageBuffer);
      } catch (err) {
        logger.error(
          {
            errorName: err instanceof Error ? err.name : "UnknownError",
            hostname,
          },
          "Error storing image",
        );
      }
    }

    if (imageBuffer === null) {
      c.header("Retry-After", "2");
      throw new HTTPException(503, { message: "Screenshot service is temporarily unavailable" });
    }

    logger.info(
      {
        bytes: imageBuffer.byteLength,
        cacheHit,
        durationMs: Date.now() - startedAt,
        hostname,
      },
      "Screenshot rendered",
    );

    return c.body(new Uint8Array(imageBuffer), 200, {
      "Content-Type": "image/png",
      "Cache-Control": process.env.CACHE_CONTROL ?? "public, max-age=86400, immutable",
    });
  };
}
