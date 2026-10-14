import { DynamicConfig } from './dynamic-config.js';

export class LockoutConfig {
  constructor(private config: DynamicConfig) {}

  getThreshold(): number {
    const raw = this.config.get<number>('lockout.threshold', 5);
    return Math.max(raw, 3);
  }

  setThreshold(value: number): void {
    this.config.set('lockout.threshold', Math.max(value, 3));
  }

  getDurationMinutes(): number {
    return this.config.get<number>('lockout.durationMinutes', 15);
  }

  setDurationMinutes(value: number): void {
    this.config.set('lockout.durationMinutes', value);
  }

  isPermanentLock(): boolean {
    return this.getDurationMinutes() === 0;
  }

  getDurationMs(): number {
    return this.getDurationMinutes() * 60000;
  }
}
