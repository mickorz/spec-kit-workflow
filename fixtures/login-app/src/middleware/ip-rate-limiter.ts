import type { DynamicConfig } from '../config/dynamic-config.js';
import type { Clock } from '../utils/clock.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

interface IpEntry {
  count: number;
  windowStart: number;
  bannedUntil: number | null;
}

export class IpRateLimiter {
  private entries = new Map<string, IpEntry>();

  constructor(
    private config: DynamicConfig,
    private clock: Clock,
  ) {}

  private getMaxFailures(): number {
    return this.config.get<number>('rateLimit.maxFailures', 10);
  }

  private getWindowMs(): number {
    return this.config.get<number>('rateLimit.windowMinutes', 1) * 60000;
  }

  private getBanMs(): number {
    return this.config.get<number>('rateLimit.banMinutes', 5) * 60000;
  }

  isAllowed(ip: string): boolean {
    const now = this.clock.now();
    const windowMs = this.getWindowMs();
    const maxFailures = this.getMaxFailures();

    let entry = this.entries.get(ip);
    if (!entry) {
      entry = { count: 0, windowStart: now, bannedUntil: null };
      this.entries.set(ip, entry);
    }

    if (entry.bannedUntil !== null && now < entry.bannedUntil) {
      return false;
    }

    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
      entry.bannedUntil = null;
    }

    return entry.count < maxFailures;
  }

  recordFailure(ip: string): void {
    const now = this.clock.now();
    const maxFailures = this.getMaxFailures();
    const banMs = this.getBanMs();

    let entry = this.entries.get(ip);
    if (!entry) {
      entry = { count: 0, windowStart: now, bannedUntil: null };
      this.entries.set(ip, entry);
    }

    entry.count += 1;
    if (entry.count >= maxFailures) {
      entry.bannedUntil = now + banMs;
    }
  }

  isBanned(ip: string): boolean {
    const entry = this.entries.get(ip);
    if (!entry || entry.bannedUntil === null) {
      return false;
    }
    return this.clock.now() < entry.bannedUntil;
  }

  getRemainingBanMs(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry || entry.bannedUntil === null) {
      return 0;
    }
    const remaining = entry.bannedUntil - this.clock.now();
    return remaining > 0 ? remaining : 0;
  }

  clear(): void {
    this.entries.clear();
  }
}
