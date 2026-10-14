export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private current: number;

  constructor(initial: number = 1_000_000_000_000) {
    this.current = initial;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  setTime(time: number): void {
    this.current = time;
  }
}
