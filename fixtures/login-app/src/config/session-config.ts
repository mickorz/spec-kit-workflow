import { DynamicConfig } from './dynamic-config.js';

export type SessionPolicy = 'ALLOW_MULTI' | 'SINGLE_SESSION';

export class SessionConfig {
  constructor(private config: DynamicConfig) {}

  getTokenTTLSeconds(): number {
    return this.config.get<number>('session.ttlSeconds', 3600);
  }

  setTokenTTLSeconds(value: number): void {
    this.config.set('session.ttlSeconds', value);
  }

  getSecretKey(): string {
    return this.config.get<string>('session.secretKey', 'default-dev-secret-key-change-me');
  }

  setSecretKey(value: string): void {
    this.config.set('session.secretKey', value);
  }

  getSessionPolicy(): SessionPolicy {
    return this.config.get<SessionPolicy>('session.policy', 'ALLOW_MULTI');
  }

  setSessionPolicy(value: SessionPolicy): void {
    this.config.set('session.policy', value);
  }
}
