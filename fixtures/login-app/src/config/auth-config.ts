import { DynamicConfig } from './dynamic-config.js';

export class AuthConfig {
  constructor(private config: DynamicConfig) {}

  isCaseSensitive(): boolean {
    return this.config.get<boolean>('auth.caseSensitive', true);
  }

  setCaseSensitive(value: boolean): void {
    this.config.set('auth.caseSensitive', value);
  }
}
