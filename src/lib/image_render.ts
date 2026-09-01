import sharp from "sharp";
import { errors as playwrightErrors } from "playwright";

import { BrowserPool } from "./browser_pool.js";
import { preparePageForFullScreenshot } from "./full_page.js";
import { IConfigAPI } from "./schema.js";

export type WaitForOptions = {
  timeout: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
};

export interface ImageRenderInterface {
  screenshot(url: string, config: IConfigAPI): Promise<Buffer>;
}

export class ImageRenderService implements ImageRenderInterface {
  private readonly NAV_OPTIONS: WaitForOptions;
  private readonly postLoadWaitMs: number;

  constructor(
    private readonly browserPool: BrowserPool,
    private readonly defaultConfig: IConfigAPI = {},
    navigationOptions: Partial<WaitForOptions> = {},
  ) {
    this.NAV_OPTIONS = {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.BROWSER_TIMEOUT) || 10000,
      ...navigationOptions,
    };
    this.postLoadWaitMs = Number(process.env.BROWSER_POST_LOAD_WAIT_MS) || 500;
  }

  public async screenshot(url: string, config: IConfigAPI = {}): Promise<Buffer> {
    const { width, height, ...defaultConfig } = this.defaultConfig;
    config = {
      ...defaultConfig,
      ...config,
      width: config.width ?? width,
      height: config.height ?? (config.isFullPage ? undefined : height),
      viewportWidth:
        config.viewportWidth ?? config.viewPortWidth ?? defaultConfig.viewportWidth,
      viewportHeight:
        config.viewportHeight ?? config.viewPortHeight ?? defaultConfig.viewportHeight,
      isMobile: config.isMobile ?? defaultConfig.isMobile,
      isFullPage: config.isFullPage ?? defaultConfig.isFullPage,
      isDarkMode: config.isDarkMode ?? defaultConfig.isDarkMode,
      deviceScaleFactor: config.deviceScaleFactor ?? defaultConfig.deviceScaleFactor,
    };

    const browser = await this.browserPool.acquire();
    let browserReusable = true;

    try {
      const page = await browser.newPage({
        viewport: {
          width: config.viewportWidth!,
          height: config.viewportHeight!,
        },
        isMobile: !!config.isMobile,
        colorScheme: config.isDarkMode ? "dark" : "light",
        deviceScaleFactor: config.deviceScaleFactor ?? 1,
      });

      try {
        try {
          await page.goto(url, this.NAV_OPTIONS);
        } catch (error) {
          if (!(error instanceof playwrightErrors.TimeoutError)) {
            throw error;
          }
        }

        if (config.isFullPage) {
          await preparePageForFullScreenshot(page);
        } else if (this.postLoadWaitMs > 0) {
          await page.waitForTimeout(this.postLoadWaitMs);
        }

        let resizeWidth: number | undefined = undefined;
        let resizeHeight: number | undefined = undefined;

        if (typeof config.width === "number") {
          resizeWidth = config.width;
        }

        if (
          config.isFullPage &&
          typeof resizeWidth === "undefined" &&
          typeof config.height === "number"
        ) {
          resizeHeight = config.height;
        }

        return await this.resize(
          await page.screenshot({ fullPage: !!config.isFullPage }),
          resizeWidth,
          resizeHeight,
        );
      } finally {
        await page.close();
      }
    } catch (error) {
      browserReusable = false;
      throw error;
    } finally {
      if (browserReusable) {
        await this.browserPool.release(browser);
      } else {
        await this.browserPool.destroy(browser);
      }
    }
  }

  private async resize(image: Buffer, width?: number, height?: number): Promise<Buffer> {
    return await sharp(image).resize(width, height, { position: "top" }).toBuffer();
  }
}
