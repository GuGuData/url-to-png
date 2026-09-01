import { StringEncrypter } from "@jmondi/string-encrypt-decrypt";
import type { Hono } from "hono";
import { it, describe, suite, expect, beforeEach } from "vitest";

import { type AppEnv, createApplication } from "../src/app.js";
import { createBrowserPool, createImageStorageService } from "../src/lib/factory.js";
import type { ImageRenderInterface } from "../src/lib/image_render.js";
import { StubImageRenderService, StubMarkdownRenderService } from "./helpers/stubs.js";

suite("app", () => {
  let app: Hono<AppEnv>;

  const browserPool = createBrowserPool();
  const imageStorageService = createImageStorageService();
  const imageRenderService = new StubImageRenderService();
  const markdownRenderService = new StubMarkdownRenderService();

  beforeEach(() => {
    app = createApplication(
      browserPool,
      imageRenderService,
      imageStorageService,
      markdownRenderService,
    );
  });

  describe("GET /ping", () => {
    it("success", async () => {
      const res = await app.request("/ping");
      expect(res.status).toBe(200);
      expect(await res.json()).toBe("pong");
    });
  });

  describe("GET /metrics", () => {
    beforeEach(() => {
      process.env.METRICS = "true";
      app = createApplication(
        browserPool,
        imageRenderService,
        imageStorageService,
        markdownRenderService,
      );
    });

    it("success", async () => {
      const res = await app.request("/metrics");
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        poolMetrics: {
          available: 0,
          borrowed: 0,
          max: 10,
          min: 2,
          pending: 0,
          size: 2,
          spareResourceCapacity: 8,
        },
        requestMetrics: {
          active: 0,
          failed: 0,
          succeeded: 0,
          total: 0,
        },
      });
    });
  });

  describe("GET /?url=", () => {
    it("succeeds with minimal", async () => {
      const res = await app.request("/?url=https://google.com");
      expect(res.status).toBe(200);
    });

    it("succeeds with resize", async () => {
      const res = await app.request("/?url=https://google.com&width=500&height=500");
      expect(res.status).toBe(200);
    });

    it("succeeds with uri encoded url", async () => {
      const url = encodeURIComponent("https://jasonraimondi.com");
      const res = await app.request(`/?url=${url}`);
      expect(res.status).toBe(200);
    });

    it("returns a retriable response when rendering fails", async () => {
      const failingRenderer: ImageRenderInterface = {
        screenshot: async () => {
          throw new Error("internal browser failure");
        },
      };
      app = createApplication(
        browserPool,
        failingRenderer,
        imageStorageService,
        markdownRenderService,
      );

      const res = await app.request("/?url=https://example.com");
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("2");
      expect(body.message).toBe("Screenshot service is temporarily unavailable");
      expect(JSON.stringify(body)).not.toContain("internal browser failure");
    });

    it("throws when invalid domain", async () => {
      const res = await app.request("/?url=bar");
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/Invalid query/gi);
    });

    [
      "file:///etc/passwd&width=4000",
      "view-source:file:///home/&width=4000",
      "view-source:file:///home/ec2-user/url-to-png/.env",
    ].forEach(invalidDomain => {
      it(`throws when invalid protocol ${invalidDomain}`, async () => {
        const res = await app.request(`/?url=${invalidDomain}`);
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/url - must start with http or https/gi);
      });
    });
  });

  describe("GET /?hash=", () => {
    describe("without CRYPTO_KEY", () => {
      it("throws when server is not configured for encryption", async () => {
        const res = await app.request(
          "/?hash=str-enc:a/4xkic0kY8scM3QRJIiLLtQ3NhZxEudhmd7RZDbsuuguXkamhZe0HdW9LmnZxtGCtf0GAPO5II85fE8rSkdFNIbBATyS/INKM0hmw==:a4S74z7c4DQVtijl",
        );
        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.message).toMatch(/This server is not configured for encryption/);
      });
    });

    describe("with CRYPTO_KEY", () => {
      beforeEach(async () => {
        const cryptoKey =
          '{"kty":"oct","k":"cq8cebOn49gXxcjoRbjP93z4OpzCkyz4WJSgPnvR4ds","alg":"A256GCM","key_ops":["encrypt","decrypt"],"ext":true}';
        const stringEncrypter = await StringEncrypter.fromCryptoString(cryptoKey);
        app = createApplication(
          browserPool,
          imageRenderService,
          imageStorageService,
          markdownRenderService,
          stringEncrypter,
        );
      });

      it("succeeds!", async () => {
        const res = await app.request(
          "/?hash=str-enc:a/4xkic0kY8scM3QRJIiLLtQ3NhZxEudhmd7RZDbsuuguXkamhZe0HdW9LmnZxtGCtf0GAPO5II85fE8rSkdFNIbBATyS/INKM0hmw==:a4S74z7c4DQVtijl",
        );
        expect(res.status).toBe(200);
      });
    });
  });

  describe("GET /markdown?url=", () => {
    it("returns expanded Markdown", async () => {
      const res = await app.request(
        "/markdown?url=https://example.com&requireExpansion=true",
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        expandedCount: 1,
        markdown: "# Expanded content",
      });
    });
  });
});
