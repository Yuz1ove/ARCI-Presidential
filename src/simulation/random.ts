export interface RandomSource {
  next(): number;
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  public constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
}

export class FixedRandomSource implements RandomSource {
  public constructor(private readonly value: number) {
    if (value < 0 || value >= 1) throw new Error("fixed random value must be in [0, 1)");
  }

  public next(): number {
    return this.value;
  }
}
