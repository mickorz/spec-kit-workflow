import type { Request, Response, NextFunction } from 'express';

export interface PerformanceStats {
  count: number;
  totalTimeMs: number;
  minMs: number;
  maxMs: number;
  samples: number[];
}

export class PerformanceMiddleware {
  private stats = new Map<string, PerformanceStats>();

  track(path: string): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      const start = performance.now();
      req.timing = start;

      res.on('finish', () => {
        const duration = performance.now() - start;
        let stat = this.stats.get(path);
        if (!stat) {
          stat = { count: 0, totalTimeMs: 0, minMs: Infinity, maxMs: 0, samples: [] };
          this.stats.set(path, stat);
        }
        stat.count += 1;
        stat.totalTimeMs += duration;
        stat.minMs = Math.min(stat.minMs, duration);
        stat.maxMs = Math.max(stat.maxMs, duration);
        if (stat.samples.length < 1000) {
          stat.samples.push(duration);
        }
      });

      next();
    };
  }

  getStats(path: string): PerformanceStats | undefined {
    return this.stats.get(path);
  }

  getPercentile(path: string, percentile: number): number | null {
    const stat = this.stats.get(path);
    if (!stat || stat.samples.length === 0) {
      return null;
    }
    const sorted = [...stat.samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  clear(): void {
    this.stats.clear();
  }
}
