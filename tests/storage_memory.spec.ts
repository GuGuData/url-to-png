import { describe, expect, it } from "vitest";

import { MemoryStorageProvider } from "../src/lib/storage/memory.js";

describe("MemoryStorageProvider", () => {
  it("expires cached images", async () => {
    let now = 1000;
    const provider = new MemoryStorageProvider({
      maxBytes: 100,
      maxEntries: 10,
      now: () => now,
      ttlMs: 50,
    });

    await provider.storeImage("image", Buffer.from("png"));
    expect(await provider.fetchImage("image")).not.toBeNull();
    now += 51;
    expect(await provider.fetchImage("image")).toBeNull();
  });

  it("evicts least recently used images within entry limits", async () => {
    const provider = new MemoryStorageProvider({
      maxBytes: 100,
      maxEntries: 2,
      ttlMs: 1000,
    });

    await provider.storeImage("first", Buffer.from("1"));
    await provider.storeImage("second", Buffer.from("2"));
    await provider.fetchImage("first");
    await provider.storeImage("third", Buffer.from("3"));

    expect(await provider.fetchImage("first")).not.toBeNull();
    expect(await provider.fetchImage("second")).toBeNull();
    expect(await provider.fetchImage("third")).not.toBeNull();
  });

  it("rejects images larger than the byte limit", async () => {
    const provider = new MemoryStorageProvider({
      maxBytes: 2,
      maxEntries: 2,
      ttlMs: 1000,
    });

    expect(await provider.storeImage("large", Buffer.from("123"))).toBe(false);
    expect(await provider.fetchImage("large")).toBeNull();
  });
});
