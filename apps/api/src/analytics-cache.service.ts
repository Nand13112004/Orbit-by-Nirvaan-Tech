import { Injectable } from '@nestjs/common';

@Injectable()
export class AnalyticsCacheService {
  private readonly entries = new Map<string, { expiresAt: number; value: unknown }>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number) {
    if (this.entries.size >= 500) this.entries.clear();
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate() {
    this.entries.clear();
  }
}
