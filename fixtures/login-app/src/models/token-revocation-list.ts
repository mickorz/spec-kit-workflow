export class TokenRevocationList {
  private revoked = new Set<string>();

  add(jti: string): void {
    this.revoked.add(jti);
  }

  has(jti: string): boolean {
    return this.revoked.has(jti);
  }

  delete(jti: string): void {
    this.revoked.delete(jti);
  }

  clear(): void {
    this.revoked.clear();
  }

  size(): number {
    return this.revoked.size;
  }
}
