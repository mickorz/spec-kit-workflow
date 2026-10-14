import type { Clock } from '../utils/clock.js';
import { AuditEventType, type AuditLogEntry } from '../models/audit-log-entry.js';

const DEFAULT_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class AuditService {
  private entries: AuditLogEntry[] = [];
  private readonly createdAt: number;
  private readonly retentionDays: number;

  constructor(
    private clock: Clock,
    retentionDays: number = DEFAULT_RETENTION_DAYS,
  ) {
    this.createdAt = clock.now();
    this.retentionDays = retentionDays;
  }

  log(
    eventType: AuditEventType,
    userId: string | undefined,
    ip: string | undefined,
    result: string,
    meta?: Record<string, unknown>,
  ): void {
    const entry: AuditLogEntry = {
      ts: this.clock.now(),
      eventType,
      userId,
      ip,
      result,
      meta,
    };
    this.entries.push(entry);
  }

  getEntries(): AuditLogEntry[] {
    return this.entries.map((e) => Object.freeze({ ...e, meta: e.meta ? { ...e.meta } : undefined }));
  }

  getEntriesByType(eventType: AuditEventType): AuditLogEntry[] {
    return this.entries
      .filter((e) => e.eventType === eventType)
      .map((e) => Object.freeze({ ...e, meta: e.meta ? { ...e.meta } : undefined }));
  }

  getEntriesByUser(userId: string): AuditLogEntry[] {
    return this.entries
      .filter((e) => e.userId === userId)
      .map((e) => Object.freeze({ ...e, meta: e.meta ? { ...e.meta } : undefined }));
  }

  count(): number {
    return this.entries.length;
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  isWithinRetention(entry: AuditLogEntry): boolean {
    const ageMs = this.clock.now() - entry.ts;
    return ageMs < this.retentionDays * MS_PER_DAY;
  }

  getExpiredEntries(): AuditLogEntry[] {
    return this.entries.filter((e) => !this.isWithinRetention(e));
  }

  pruneExpired(): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => this.isWithinRetention(e));
    return before - this.entries.length;
  }

  resetForTesting(): void {
    this.entries = [];
  }
}
