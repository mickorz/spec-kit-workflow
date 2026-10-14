import type { PasswordHasher, PasswordHasherRegistry } from './password-hasher.js';
import type { UserRepository } from '../repositories/user-repository.js';

export interface MigrationResult {
  migrated: boolean;
  userId: string;
  fromAlgorithm: string;
  toAlgorithm: string;
}

export class PasswordMigrationService {
  constructor(
    private registry: PasswordHasherRegistry,
    private userRepo: UserRepository,
  ) {}

  /**
   * 登录时检测旧算法哈希并迁移 (FR-006 AC-023)
   * 若 storedHash 为旧算法且校验通过，自动用新算法重新哈希并更新存储
   */
  async migrateIfNeeded(
    userId: string,
    plain: string,
    storedHash: string,
  ): Promise<MigrationResult> {
    const detectedAlgo = this.registry.detectAlgorithm(storedHash);
    const defaultAlgo = this.registry.getDefault().getAlgorithm();

    const fromAlgo = detectedAlgo ?? 'unknown';

    if (detectedAlgo === defaultAlgo) {
      return { migrated: false, userId, fromAlgorithm: fromAlgo, toAlgorithm: defaultAlgo };
    }

    const oldHasher = detectedAlgo ? this.registry.get(detectedAlgo) : null;
    if (!oldHasher) {
      return { migrated: false, userId, fromAlgorithm: fromAlgo, toAlgorithm: defaultAlgo };
    }

    const matches = await oldHasher.verify(plain, storedHash);
    if (!matches) {
      return { migrated: false, userId, fromAlgorithm: fromAlgo, toAlgorithm: defaultAlgo };
    }

    const newHasher = this.registry.getDefault();
    const newHash = await newHasher.hash(plain);

    const user = await this.userRepo.findById(userId);
    if (user) {
      user.passwordHash = newHash;
      await this.userRepo.save(user);
    }

    return { migrated: true, userId, fromAlgorithm: fromAlgo, toAlgorithm: defaultAlgo };
  }
}
