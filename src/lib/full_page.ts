import type { Page } from "playwright";

type FullPagePreparationOptions = {
  initialWaitMs: number;
  maxExpandedHeight: number;
  maxScrollRounds: number;
  settleDelayMs: number;
  stableRounds: number;
};

const DEFAULT_OPTIONS: FullPagePreparationOptions = {
  initialWaitMs: Number(process.env.FULL_PAGE_INITIAL_WAIT_MS) || 800,
  maxExpandedHeight: Number(process.env.FULL_PAGE_MAX_HEIGHT) || 30000,
  maxScrollRounds: Number(process.env.FULL_PAGE_MAX_SCROLL_ROUNDS) || 30,
  settleDelayMs: Number(process.env.FULL_PAGE_SCROLL_DELAY_MS) || 200,
  stableRounds: Number(process.env.FULL_PAGE_STABLE_ROUNDS) || 2,
};

export async function preparePageForFullScreenshot(
  page: Page,
  options: Partial<FullPagePreparationOptions> = {},
): Promise<void> {
  const config = { ...DEFAULT_OPTIONS, ...options };

  await page.evaluate(async input => {
    const wait = (milliseconds: number) =>
      new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
    const scrollableOverflow = new Set(["auto", "scroll"]);

    const findScrollableElements = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter(element => {
          const style = window.getComputedStyle(element);
          return (
            scrollableOverflow.has(style.overflowY) &&
            element.clientHeight >= 100 &&
            element.scrollHeight > element.clientHeight + 1
          );
        })
        .sort(
          (left, right) =>
            right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight),
        );

    await wait(input.initialWaitMs);

    let previousSignature = "";
    let stableRoundCount = 0;

    for (let round = 0; round < input.maxScrollRounds; round += 1) {
      const elements = findScrollableElements();
      let moved = false;

      for (const element of elements) {
        const maximumScrollTop = Math.min(
          element.scrollHeight - element.clientHeight,
          Math.max(0, input.maxExpandedHeight - element.clientHeight),
        );
        const nextScrollTop = Math.min(
          maximumScrollTop,
          element.scrollTop + Math.max(100, Math.floor(element.clientHeight * 0.8)),
        );

        if (nextScrollTop > element.scrollTop + 1) {
          element.scrollTop = nextScrollTop;
          moved = true;
        }
      }

      const documentScrollHeight = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement.scrollHeight,
      );
      const maximumWindowScroll = Math.min(
        documentScrollHeight - window.innerHeight,
        Math.max(0, input.maxExpandedHeight - window.innerHeight),
      );
      const nextWindowScroll = Math.min(
        maximumWindowScroll,
        window.scrollY + Math.max(100, Math.floor(window.innerHeight * 0.8)),
      );
      if (nextWindowScroll > window.scrollY + 1) {
        window.scrollTo(0, nextWindowScroll);
        moved = true;
      }

      await wait(input.settleDelayMs);

      const signature = findScrollableElements()
        .map(element => `${element.scrollTop}:${element.clientHeight}:${element.scrollHeight}`)
        .join("|");

      if (!moved && signature === previousSignature) {
        stableRoundCount += 1;
        if (stableRoundCount >= input.stableRounds) {
          break;
        }
      } else {
        stableRoundCount = 0;
      }
      previousSignature = signature;
    }

    const pendingImages = Array.from(document.images).filter(
      image => !image.complete || image.naturalWidth === 0,
    );
    await Promise.race([
      Promise.all(
        pendingImages.map(
          image =>
            new Promise<void>(resolve => {
              if (image.complete) {
                resolve();
                return;
              }
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      ),
      wait(Math.min(2000, input.initialWaitMs + input.settleDelayMs * 4)),
    ]);

    const candidates = findScrollableElements().filter(
      element =>
        element.clientHeight >= window.innerHeight * 0.4 &&
        element.scrollHeight <= input.maxExpandedHeight,
    );
    const topLevelCandidates = candidates.filter(
      candidate => !candidates.some(other => other !== candidate && other.contains(candidate)),
    );

    for (const element of topLevelCandidates) {
      const expandedHeight = element.scrollHeight;
      element.scrollTop = 0;
      element.style.setProperty("height", `${expandedHeight}px`, "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow-y", "visible", "important");
      element.style.setProperty("flex", "none", "important");

      let ancestor = element.parentElement;
      while (ancestor) {
        ancestor.style.setProperty("height", "auto", "important");
        ancestor.style.setProperty("max-height", "none", "important");
        ancestor.style.setProperty("overflow-y", "visible", "important");
        ancestor = ancestor.parentElement;
      }
    }

    window.scrollTo(0, 0);
    await new Promise<void>(resolve =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
    );
    await wait(input.settleDelayMs);
  }, config);
}
