import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Clock } from '../utils/clock.js';
import type { SessionConfig } from '../config/session-config.js';
import { TokenRevocationList } from '../models/token-revocation-list.js';
import { ActiveSessionRegistry } from '../models/active-session-registry.js';
import type { AuditService } from './audit-service.js';
import { AuditEventType } from '../models/audit-log-entry.js';
import { AppError } from '../utils/app-error.js';
import { ErrorMessages } from '../utils/error-messages.js';

export interface TokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  roles: string[];
}

export interface SessionResult {
  token: string;
  expiresIn: number;
  expiresAt: number;
}

function isTokenPayload(payload: string | JwtPayload | undefined): payload is TokenPayload {
  return typeof payload === 'object' && payload !== null && 'sub' in payload && 'jti' in payload;
}

export class SessionService {
  constructor(
    private config: SessionConfig,
    private clock: Clock,
    private revocationList: TokenRevocationList,
    private activeSessions: ActiveSessionRegistry,
    private auditService: AuditService,
  ) {}

  /**
   * 创建登录会话并签发 JWT (FR-007 AC-024)
   * - payload 含 sub(userId), jti(唯一标识), iat(签发时间), exp(过期时间)
   * - SINGLE_SESSION 策略下，新登录时吊销同账号已有 Token (AC-027)
   */
  create(userId: string, roles: string[]): SessionResult {
    const now = this.clock.now();
    const ttlSeconds = this.config.getTokenTTLSeconds();
    const expiresAt = now + ttlSeconds * 1000;
    const jti = randomUUID();

    const payload: TokenPayload = {
      sub: userId,
      jti,
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt / 1000),
      roles,
    };

    const token = jwt.sign(payload, this.config.getSecretKey());

    if (this.config.getSessionPolicy() === 'SINGLE_SESSION') {
      const oldJti = this.activeSessions.get(userId);
      if (oldJti) {
        this.revocationList.add(oldJti);
      }
    }
    this.activeSessions.set(userId, jti);

    return { token, expiresIn: ttlSeconds, expiresAt };
  }

  /**
   * 校验 JWT 凭证 (FR-007 AC-025/AC-026)
   * - 过期 → 返回 TOKEN_EXPIRED
   * - 在吊销列表 → 返回 TOKEN_REVOKED
   * - 有效 → 返回 payload
   */
  verify(token: string): TokenPayload {
    let decoded: string | JwtPayload | undefined;
    try {
      decoded = jwt.verify(token, this.config.getSecretKey(), {
        clockTimestamp: Math.floor(this.clock.now() / 1000),
      });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED', 401, ErrorMessages.TOKEN_EXPIRED);
      }
      throw new AppError('TOKEN_INVALID', 401, ErrorMessages.TOKEN_INVALID);
    }

    if (!isTokenPayload(decoded)) {
      throw new AppError('TOKEN_INVALID', 401, ErrorMessages.TOKEN_INVALID);
    }

    if (this.revocationList.has(decoded.jti)) {
      throw new AppError('TOKEN_REVOKED', 401, ErrorMessages.TOKEN_REVOKED);
    }

    return decoded;
  }

  /**
   * 登出：吊销凭证 (FR-007 AC-026)
   * 将 Token 的 jti 加入服务端吊销列表，后续使用该 Token 的请求被拒绝
   */
  revoke(jti: string, userId: string): void {
    this.revocationList.add(jti);
    this.activeSessions.delete(userId);
    this.auditService.log(AuditEventType.LOGOUT, userId, undefined, 'success');
  }

  getTokenJti(token: string): string | null {
    try {
      const decoded = jwt.decode(token) as JwtPayload | null;
      if (decoded && typeof decoded === 'object' && 'jti' in decoded) {
        return (decoded as TokenPayload).jti;
      }
      return null;
    } catch {
      return null;
    }
  }
}
