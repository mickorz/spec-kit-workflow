import bcrypt from 'bcryptjs';
import type { PasswordHasher } from './password-hasher.js';

export class BcryptHasher implements PasswordHasher {
  private costFactor: number;

  constructor(costFactor: number = 12) {
    this.costFactor = Math.max(costFactor, 10);
  }

  getAlgorithm(): string {
    return 'bcrypt';
  }

  getCostFactor(): number {
    return this.costFactor;
  }

  async hash(plain: string): Promise<string> {
    const salt = await bcrypt.genSalt(this.costFactor);
    return bcrypt.hash(plain, salt);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  async measureHashTime(plain: string): Promise<number> {
    const start = performance.now();
    await this.hash(plain);
    return performance.now() - start;
  }

  async meetsMinTime(plain: string, minMs: number): Promise<boolean> {
    const elapsed = await this.measureHashTime(plain);
    return elapsed >= minMs;
  }
}
