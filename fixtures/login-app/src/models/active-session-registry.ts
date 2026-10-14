export class ActiveSessionRegistry {
  private sessions = new Map<string, string>();

  set(userId: string, jti: string): void {
    this.sessions.set(userId, jti);
  }

  get(userId: string): string | undefined {
    return this.sessions.get(userId);
  }

  delete(userId: string): void {
    this.sessions.delete(userId);
  }

  clear(): void {
    this.sessions.clear();
  }
}
