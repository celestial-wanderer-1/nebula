/** A bounded buffer that drops its oldest items (D106: progress may drop). */
export class RingBuffer<T> {
  private items: T[] = [];
  /** Items dropped since creation, to say so in the UI. */
  dropped = 0;

  constructor(readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      const excess = this.items.length - this.capacity;
      this.items.splice(0, excess);
      this.dropped += excess;
    }
  }

  toArray(): readonly T[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.dropped = 0;
  }
}
