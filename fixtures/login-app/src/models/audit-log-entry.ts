export enum AuditEventType {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOCK_TRIGGERED = 'LOCK_TRIGGERED',
  AUTO_UNLOCK = 'AUTO_UNLOCK',
  ADMIN_UNLOCK = 'ADMIN_UNLOCK',
  LOGOUT = 'LOGOUT',
}

export interface AuditLogEntry {
  ts: number;
  eventType: AuditEventType;
  userId: string | undefined;
  ip: string | undefined;
  result: string;
  meta?: Record<string, unknown>;
}
