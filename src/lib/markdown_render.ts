import type { Browser } from "playwright";
import { errors as playwrightErrors } from "playwright";
import TurndownService from "turndown";

import { BrowserPool } from "./browser_pool.js";

export type MarkdownRenderResult = {
  expandedCount: number;
  markdown: string;
};

export interface MarkdownRenderInterface {
  render(url: string, requireExpansion?: boolean): Promise<MarkdownRenderResult>;
}

const EXPANSION_PATTERN =
  /(?:参考\s*\d+\s*篇资料|展开(?:全部|详情|内容|全文|更多)?|显示更多|查看更多|点击展开|show\s+(?:more|details|sources|references)|view\s+(?:more|details|sources|references)|read\s+more)/i;
const BLOCKED_ACTION_PATTERN = /(?:登录|注册|购买|支付|订阅|打开豆包|login|sign\s*in|sign\s*up|buy|pay|subscribe)/i;

export class MarkdownRenderService implements MarkdownRenderInterface {
  private readonly navigationTimeoutMs = Number(process.env.BROWSER_TIMEOUT) || 10000;
  private readonly postLoadWaitMs = Number(process.env.MARKDOWN_POST_LOAD_WAIT_MS) || 1200;
  private readonly expansionWaitMs = Number(process.env.MARKDOWN_EXPANSION_WAIT_MS) || 1200;

  constructor(private readonly browserPool: BrowserPool) {}

  public async render(url: string, requireExpansion = false): Promise<MarkdownRenderResult> {
    const maxAttempts = requireExpansion ? 3 : 1;
    let bestResult: MarkdownRenderResult | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const browser = await this.browserPool.acquire();
      try {
        const result = await this.renderWithBrowser(browser, url);
        if (!bestResult || result.markdown.length > bestResult.markdown.length) {
          bestResult = result;
        }

        if (!requireExpansion || result.expandedCount > 0) {
          await this.browserPool.release(browser);
          return result;
        }

        await this.browserPool.destroy(browser);
      } catch (error) {
        lastError = error;
        await this.browserPool.destroy(browser);
      }
    }

    if (bestResult) {
      return bestResult;
    }

    throw lastError instanceof Error ? lastError : new Error("Markdown rendering failed");
  }

  private async renderWithBrowser(browser: Browser, url: string): Promise<MarkdownRenderResult> {
    const page = await browser.newPage({ viewport: { height: 1080, width: 1080 } });

    try {
      try {
        await page.goto(url, {
          timeout: this.navigationTimeoutMs,
          waitUntil: "domcontentloaded",
        });
      } catch (error) {
        if (!(error instanceof playwrightErrors.TimeoutError)) {
          throw error;
        }
      }

      await page.waitForTimeout(this.postLoadWaitMs);
      const expandedCount = await this.expandVisibleContent(page);
      if (expandedCount > 0) {
        await page.waitForTimeout(this.expansionWaitMs);
      }

      const bodyHtml = await page.locator("body").innerHTML();
      const turndown = new TurndownService({
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
        headingStyle: "atx",
      });
      turndown.remove(["script", "style", "noscript", "template"]);
      turndown.remove(node => node.nodeName === "SVG");
      const markdown = turndown
        .turndown(bodyHtml)
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (!markdown) {
        throw new Error("Rendered page did not contain Markdown content");
      }

      return { expandedCount, markdown };
    } finally {
      await page.close();
    }
  }

  private async expandVisibleContent(page: import("playwright").Page): Promise<number> {
    const expandedCount = await page.evaluate(
      ({ blockedPatternSource, expansionPatternSource }) => {
        const expansionPattern = new RegExp(expansionPatternSource, "i");
        const blockedPattern = new RegExp(blockedPatternSource, "i");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .map(candidate => {
            const text = (candidate.innerText || candidate.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            const style = window.getComputedStyle(candidate);
            const depth = (() => {
              let value = 0;
              let current: HTMLElement | null = candidate;
              while (current && current !== document.body) {
                value += 1;
                current = current.parentElement;
              }
              return value;
            })();
            const interactive =
              candidate.matches("button,[role='button'],summary") || style.cursor === "pointer";
            return { candidate, depth, interactive, style, text };
          })
          .filter(
            ({ candidate, style, text }) =>
              text.length > 0 &&
              text.length <= 120 &&
              expansionPattern.test(text) &&
              !blockedPattern.test(text) &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              candidate.getBoundingClientRect().width >= 1 &&
              candidate.getBoundingClientRect().height >= 1,
          )
          .sort((left, right) => {
            if (left.interactive !== right.interactive) {
              return left.interactive ? -1 : 1;
            }
            return right.depth - left.depth;
          });
        const clicked = new Set<HTMLElement>();
        const clickedTexts = new Set<string>();
        let expandedCount = 0;

        for (const { candidate, text } of candidates) {
          if (expandedCount >= 12) break;
          const normalizedText = text.toLocaleLowerCase();
          if (clickedTexts.has(normalizedText)) {
            continue;
          }

          const details = candidate.closest("details");
          if (details && !details.open) {
            details.open = true;
            expandedCount += 1;
            continue;
          }

          const target =
            candidate.closest<HTMLElement>("button,[role='button'],summary") ?? candidate;
          if (target.closest("a[href]") || clicked.has(target)) {
            continue;
          }

          clicked.add(target);
          clickedTexts.add(normalizedText);
          target.click();
          expandedCount += 1;
        }

        return expandedCount;
      },
      {
        blockedPatternSource: BLOCKED_ACTION_PATTERN.source,
        expansionPatternSource: EXPANSION_PATTERN.source,
      },
    );
    if (expandedCount > 0) {
      return expandedCount;
    }

    const textTriggers = page.getByText(EXPANSION_PATTERN);
    const triggerCount = Math.min(await textTriggers.count(), 12);
    for (let index = triggerCount - 1; index >= 0; index -= 1) {
      const trigger = textTriggers.nth(index);
      if (!(await trigger.isVisible())) {
        continue;
      }

      const blocked = await trigger.evaluate((element, blockedPatternSource) => {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        return element.closest("a[href]") !== null ||
          new RegExp(blockedPatternSource, "i").test(text);
      }, BLOCKED_ACTION_PATTERN.source);
      if (blocked) {
        continue;
      }

      try {
        await trigger.click({ timeout: 1500 });
        return 1;
      } catch {
        // Try the next matching visible text element.
      }
    }

    return 0;
  }
}
