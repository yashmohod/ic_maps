/** Comparator: return <0 if a before b, 0 if equal, >0 if a after b */
export type Compare<T> = (a: T, b: T) => number;

export class MinHeap<T> {
  /** 1-based: index 0 unused */
  private heap: (T | undefined)[] = [undefined];

  constructor(private readonly cmp: Compare<T>) {}

  private parent(i: number) {
    return i >> 1;
  }
  private lc(i: number) {
    return i << 1;
  }
  private rc(i: number) {
    return (i << 1) + 1;
  }

  size() {
    return this.heap.length - 1;
  }
  isEmpty() {
    return this.size() === 0;
  }

  peek(): T | undefined {
    return this.heap[1];
  }

  add(x: T) {
    this.heap.push(x);
    this.heapifyUp(this.heap.length - 1);
  }

  remove(): T | undefined {
    if (this.heap.length <= 1) return undefined;

    const res = this.heap[1]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 1) {
      this.heap[1] = last;
      this.heapifyDown(1);
    }
    return res;
  }

  private heapifyUp(i: number) {
    while (i > 1) {
      const p = this.parent(i);
      if (this.cmp(this.heap[i]!, this.heap[p]!) >= 0) break;
      this.swap(i, p);
      i = p;
    }
  }

  private heapifyDown(i: number) {
    while (true) {
      const l = this.lc(i);
      const r = this.rc(i);
      let smallest = i;

      if (
        l < this.heap.length &&
        this.cmp(this.heap[l]!, this.heap[smallest]!) < 0
      )
        smallest = l;
      if (
        r < this.heap.length &&
        this.cmp(this.heap[r]!, this.heap[smallest]!) < 0
      )
        smallest = r;

      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(i: number, j: number) {
    const t = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = t;
  }
}
