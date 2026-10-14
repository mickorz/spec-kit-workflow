export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  getAlgorithm(): string;
}

export class PasswordHasherRegistry {
  private hashers = new Map<string, PasswordHasher>();
  private defaultAlgorithm: string;

  constructor(defaultAlgorithm: string) {
    this.defaultAlgorithm = defaultAlgorithm;
  }

  register(algorithm: string, hasher: PasswordHasher): void {
    this.hashers.set(algorithm, hasher);
  }

  get(algorithm?: string): PasswordHasher {
    const algo = algorithm ?? this.defaultAlgorithm;
    const hasher = this.hashers.get(algo);
    if (!hasher) {
      throw new Error(`未注册的密码哈希算法: ${algo}`);
    }
    return hasher;
  }

  getDefault(): PasswordHasher {
    return this.get(this.defaultAlgorithm);
  }

  setDefaultAlgorithm(algorithm: string): void {
    this.defaultAlgorithm = algorithm;
  }

  getDefaultAlgorithm(): string {
    return this.defaultAlgorithm;
  }

  detectAlgorithm(hash: string): string | null {
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
      return 'bcrypt';
    }
    return null;
  }

  has(algorithm: string): boolean {
    return this.hashers.has(algorithm);
  }
}
