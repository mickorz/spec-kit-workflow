export type UserStatus = 'enabled' | 'disabled';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  roles: string[];
  createdAt: number;
}

export function createUser(opts: {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  status?: UserStatus;
  roles?: string[];
  createdAt?: number;
}): User {
  return {
    id: opts.id,
    username: opts.username,
    email: opts.email,
    passwordHash: opts.passwordHash,
    status: opts.status ?? 'enabled',
    roles: opts.roles ?? [],
    createdAt: opts.createdAt ?? Date.now(),
  };
}
