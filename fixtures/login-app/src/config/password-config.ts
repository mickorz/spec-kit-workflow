import { DynamicConfig } from './dynamic-config.js';

export class PasswordConfig {
  constructor(private config: DynamicConfig) {}

  getCostFactor(): number {
    const raw = this.config.get<number>('password.costFactor', 12);
    return Math.max(raw, 10);
  }

  setCostFactor(value: number): void {
    this.config.set('password.costFactor', value);
  }

  getAlgorithm(): string {
    return this.config.get<string>('password.algorithm', 'bcrypt');
  }

  setAlgorithm(value: string): void {
    this.config.set('password.algorithm', value);
  }

  getMinHashTimeMs(): number {
    return this.config.get<number>('password.minHashTimeMs', 100);
  }

  setMinHashTimeMs(value: number): void {
    this.config.set('password.minHashTimeMs', value);
  }
}
