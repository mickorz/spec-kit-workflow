export interface AccountLock {
  userId: string;
  failedAttempts: number;
  lockedAt: number | null;
  lockDurationMs: number;
  permanent: boolean;
}

export function createAccountLock(userId: string): AccountLock {
  return {
    userId,
    failedAttempts: 0,
    lockedAt: null,
    lockDurationMs: 0,
    permanent: false,
  };
}

export interface LockStatus {
  locked: boolean;
  permanent?: boolean;
  remainingMs?: number;
  remainingMinutes?: number;
}
