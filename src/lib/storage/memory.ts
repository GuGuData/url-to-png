import { ImageStorage } from "./_base.js";

type MemoryStorageEntry = {
  expiresAt: number;
  image: Buffer;
};

export type MemoryStorageOptions = {
  maxBytes: number;
  maxEntries: number;
  now?: () => number;
  ttlMs: number;
};

export class MemoryStorageProvider implements ImageStorage {
  private readonly entries = new Map<string, MemoryStorageEntry>();
  private readonly now: () => number;
  private totalBytes = 0;

  constructor(private readonly options: MemoryStorageOptions) {
    if (options.maxBytes <= 0 || options.maxEntries <= 0 || options.ttlMs <= 0) {
      throw new Error("Memory storage limits must be positive");
    }
    this.now = options.now ?? Date.now;
  }

  async fetchImage(imageId: string): Promise<Buffer | null> {
    const entry = this.entries.get(imageId);
    if (!entry) return null;

    if (entry.expiresAt <= this.now()) {
      this.remove(imageId, entry);
      return null;
    }

    this.entries.delete(imageId);
    this.entries.set(imageId, entry);
    return entry.image;
  }

  async storeImage(imageId: string, image: Buffer): Promise<boolean> {
    if (image.byteLength > this.options.maxBytes) return false;

    const existing = this.entries.get(imageId);
    if (existing) this.remove(imageId, existing);

    this.removeExpired();
    while (
      this.entries.size >= this.options.maxEntries ||
      this.totalBytes + image.byteLength > this.options.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, MemoryStorageEntry]
        | undefined;
      if (!oldest) break;
      this.remove(oldest[0], oldest[1]);
    }

    this.entries.set(imageId, {
      expiresAt: this.now() + this.options.ttlMs,
      image,
    });
    this.totalBytes += image.byteLength;
    return true;
  }

  private remove(imageId: string, entry: MemoryStorageEntry): void {
    if (this.entries.delete(imageId)) {
      this.totalBytes -= entry.image.byteLength;
    }
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [imageId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(imageId, entry);
    }
  }
}
