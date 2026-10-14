import type { AccountLock, LockStatus } from '../models/account-lock.js';
import { createAccountLock } from '../models/account-lock.js';

export interface AccountLockStore {
  get(userId: string): AccountLock | undefined;
  save(userId: string, lock: AccountLock): void;
  delete(userId: string): void;
}

export class InMemoryAccountLockStore implements AccountLockStore {
  private locks = new Map<string, AccountLock>();

  get(userId: string): AccountLock | undefined {
    return this.locks.get(userId);
  }

  save(userId: string, lock: AccountLock): void {
    this.locks.set(userId, { ...lock });
  }

  delete(userId: string): void {
    this.locks.delete(userId);
  }

  clear(): void {
    this.locks.clear();
  }
}
