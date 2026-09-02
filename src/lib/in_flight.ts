export type InFlightResult<T> = {
  shared: boolean;
  value: T;
};

export class InFlightCoordinator<T> {
  private readonly requests = new Map<string, Promise<T>>();

  async run(key: string, factory: () => Promise<T>): Promise<InFlightResult<T>> {
    const existing = this.requests.get(key);
    if (existing) {
      return { shared: true, value: await existing };
    }

    const request = Promise.resolve().then(factory);
    this.requests.set(key, request);

    try {
      return { shared: false, value: await request };
    } finally {
      if (this.requests.get(key) === request) {
        this.requests.delete(key);
      }
    }
  }
}
