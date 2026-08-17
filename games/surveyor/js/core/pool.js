// Fixed-size pool. FX never allocates during play.

export class Pool {
  constructor(size, factory) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < size; i++) {
      this.items.push({ live: false, age: 0, life: 1, obj: factory(i) });
    }
  }

  /** Grab the oldest slot — overwriting a live one is fine for cosmetics. */
  take() {
    let best = null;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[(this.cursor + i) % this.items.length];
      if (!it.live) { best = it; this.cursor = (this.cursor + i + 1) % this.items.length; break; }
    }
    if (!best) {
      best = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.items.length;
    }
    best.live = true;
    best.age = 0;
    return best;
  }

  forEachLive(fn) {
    for (const it of this.items) if (it.live) fn(it);
  }
}
