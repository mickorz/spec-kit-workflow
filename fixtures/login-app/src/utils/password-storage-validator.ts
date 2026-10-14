export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

export class PasswordStorageValidator {
  static validate(hash: string): PasswordValidationResult {
    if (!hash || hash.length === 0) {
      return { valid: false, reason: 'empty' };
    }
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
      return { valid: true };
    }
    if (/^[a-f0-9]{32}$/i.test(hash)) {
      return { valid: false, reason: 'unsalted_md5' };
    }
    if (/^[a-f0-9]{40}$/i.test(hash)) {
      return { valid: false, reason: 'unsalted_sha1' };
    }
    if (hash.length < 30) {
      return { valid: false, reason: 'plaintext_or_weak' };
    }
    return { valid: false, reason: 'unknown_format' };
  }

  static validateAll(hashes: Map<string, string>): { userId: string; result: PasswordValidationResult }[] {
    const results: { userId: string; result: PasswordValidationResult }[] = [];
    for (const [userId, hash] of hashes) {
      const result = this.validate(hash);
      if (!result.valid) {
        results.push({ userId, result });
      }
    }
    return results;
  }
}
