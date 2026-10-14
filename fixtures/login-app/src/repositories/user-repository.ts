import type { User, UserStatus } from '../models/user.js';

export interface UserRepository {
  findByUsername(username: string, options: { caseSensitive: boolean }): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  exists(id: string): Promise<boolean>;
  save(user: User): Promise<void>;
  getAll(): Promise<User[]>;
}

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();

  async findByUsername(username: string, options: { caseSensitive: boolean }): Promise<User | null> {
    const target = options.caseSensitive ? username : username.toLowerCase();
    for (const user of this.users.values()) {
      const current = options.caseSensitive ? user.username : user.username.toLowerCase();
      if (current === target) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async exists(id: string): Promise<boolean> {
    return this.users.has(id);
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, { ...user });
  }

  async getAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  clear(): void {
    this.users.clear();
  }
}
