export class DynamicConfig {
  private values: Record<string, unknown> = {};

  set<T>(key: string, value: T): void {
    this.values[key] = value;
  }

  get<T>(key: string, defaultValue: T): T {
    return key in this.values ? (this.values[key] as T) : defaultValue;
  }

  has(key: string): boolean {
    return key in this.values;
  }

  delete(key: string): void {
    delete this.values[key];
  }
}
