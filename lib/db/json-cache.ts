import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data');
const PREDICTIONS_FILE = path.join(CACHE_DIR, 'predictions.json');
const PREDICTIONS_BACKUP_FILE = `${PREDICTIONS_FILE}.bak`;
const LOGS_FILE = path.join(CACHE_DIR, 'analysis-logs.json');
const LOGS_BACKUP_FILE = `${LOGS_FILE}.bak`;

const DEFAULT_MAX_ENTRIES = parseInt(process.env.PREDICTION_CACHE_MAX_ENTRIES || '500', 10);

interface CacheStats {
  hits: number;
  misses: number;
  expired: number;
  lastCleanup: string | null;
  lastPersistedAt: string | null;
  totalEntries: number;
}

export interface PredictionCache {
  match_id: number;
  confidence_score: number;
  recommended_bet: string;
  prediction_data: any;
  value_bets?: any;
  last_updated: string;
  expiry_time: string;
}

export interface AnalysisLog {
  id: number;
  run_time: string;
  matches_analyzed: number;
  matches_failed: number;
  total_matches: number;
  status: string;
  error_message?: string;
}

interface CleanupOptions {
  persist?: boolean;
  reason?: string;
}

class JSONCache {
  private predictions: Map<number, PredictionCache> = new Map();
  private logs: AnalysisLog[] = [];
  private nextLogId = 1;
  private maxEntries: number = DEFAULT_MAX_ENTRIES;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    expired: 0,
    lastCleanup: null,
    lastPersistedAt: null,
    totalEntries: 0
  };

  constructor() {
    this.ensureCacheDirectory();
    this.loadData();
  }

  private ensureCacheDirectory(): void {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  private loadData(): void {
    this.predictions = new Map();
    this.logs = [];
    this.nextLogId = 1;

    const readJson = (filePath: string, backupPath: string): any | null => {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
      } catch (error) {
        console.error(`Failed to load cache file ${filePath}, attempting backup:`, error);
        if (fs.existsSync(backupPath)) {
          try {
            const rawBackup = fs.readFileSync(backupPath, 'utf-8');
            return JSON.parse(rawBackup);
          } catch (backupError) {
            console.error(`Failed to load backup cache file ${backupPath}:`, backupError);
          }
        }
        return null;
      }
    };

    const predictionsPayload = readJson(PREDICTIONS_FILE, PREDICTIONS_BACKUP_FILE);
    if (predictionsPayload?.predictions && Array.isArray(predictionsPayload.predictions)) {
      predictionsPayload.predictions.forEach((entry: PredictionCache) => {
        if (this.isValidPrediction(entry)) {
          this.predictions.set(entry.match_id, entry);
        }
      });
    }

    const logsPayload = readJson(LOGS_FILE, LOGS_BACKUP_FILE);
    if (logsPayload?.logs && Array.isArray(logsPayload.logs)) {
      this.logs = logsPayload.logs.slice(0, 100);
      this.nextLogId = (this.logs[0]?.id || 0) + 1;
    }

    const removed = this.cleanExpiredPredictions({ persist: false, reason: 'post-load' });
    if (removed > 0) {
      this.saveData({ skipCleanup: true });
    }

    this.enforceCacheLimit();
    this.stats.totalEntries = this.predictions.size;
  }

  private isValidPrediction(prediction: PredictionCache): boolean {
    if (!prediction) return false;
    const hasCoreFields = typeof prediction.match_id === 'number'
      && typeof prediction.confidence_score === 'number'
      && typeof prediction.recommended_bet === 'string'
      && typeof prediction.last_updated === 'string'
      && typeof prediction.expiry_time === 'string';

    if (!hasCoreFields) {
      console.warn('Skipping invalid prediction cache entry:', prediction);
      return false;
    }

    return true;
  }

  private enforceCacheLimit(): void {
    if (this.predictions.size <= this.maxEntries) return;

    const sortedByRecency = Array.from(this.predictions.values())
      .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

    const trimmed = sortedByRecency.slice(0, this.maxEntries);
    this.predictions = new Map(trimmed.map(prediction => [prediction.match_id, prediction]));
  }

  private persistFile(targetPath: string, backupPath: string, payload: unknown): void {
    const serialized = JSON.stringify(payload, null, 2);
    const tempPath = `${targetPath}.tmp`;

    try {
      if (fs.existsSync(targetPath)) {
        fs.copyFileSync(targetPath, backupPath);
      }

      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      console.error(`Failed to persist cache file ${targetPath}:`, error);

      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore temp cleanup errors
        }
      }

      if (fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, targetPath);
          console.warn(`Restored cache file ${targetPath} from backup.`);
        } catch (restoreError) {
          console.error(`Failed to restore cache file ${targetPath} from backup:`, restoreError);
        }
      }

      throw error;
    }
  }

  private saveData(options: { skipCleanup?: boolean } = {}): boolean {
    try {
      if (!options.skipCleanup) {
        this.cleanExpiredPredictions({ persist: false, reason: 'pre-save' });
      }

      this.enforceCacheLimit();

      const predictionsPayload = {
        predictions: Array.from(this.predictions.values())
      };
      const logsPayload = {
        logs: this.logs.slice(0, 100)
      };

      this.persistFile(PREDICTIONS_FILE, PREDICTIONS_BACKUP_FILE, predictionsPayload);
      this.persistFile(LOGS_FILE, LOGS_BACKUP_FILE, logsPayload);

      this.stats.lastPersistedAt = new Date().toISOString();
      this.stats.totalEntries = this.predictions.size;
      return true;
    } catch (error) {
      console.error('Failed to save cache data:', error);
      return false;
    }
  }

  private persistAfterExpiryRemoval(): void {
    const success = this.saveData({ skipCleanup: true });
    if (!success) {
      console.error('Failed to persist cache after removing expired predictions');
    }
  }

  cleanExpiredPredictions(options: CleanupOptions = {}): number {
    const { persist = true, reason } = options;
    const now = new Date();
    let removed = 0;

    for (const [matchId, prediction] of this.predictions.entries()) {
      if (new Date(prediction.expiry_time) <= now) {
        this.predictions.delete(matchId);
        removed++;
      }
    }

    if (removed > 0) {
      this.stats.expired += removed;
      this.stats.lastCleanup = new Date().toISOString();
      console.info(`JSONCache cleaned ${removed} expired entries${reason ? ` (${reason})` : ''}.`);

      if (persist) {
        this.persistAfterExpiryRemoval();
      }
    }

    return removed;
  }

  forceCleanup(): number {
    return this.cleanExpiredPredictions({ persist: true, reason: 'forceCleanup' });
  }

  savePrediction(prediction: PredictionCache): boolean {
    if (!this.isValidPrediction(prediction)) {
      return false;
    }

    this.predictions.set(prediction.match_id, prediction);
    this.stats.totalEntries = this.predictions.size;
    const success = this.saveData();
    if (!success) {
      console.error(`Failed to persist prediction for match ${prediction.match_id}`);
    }
    return success;
  }

  savePredictionsBatch(predictions: PredictionCache[]): boolean {
    const validPredictions = predictions.filter(prediction => this.isValidPrediction(prediction));
    if (validPredictions.length === 0) {
      return false;
    }

    validPredictions.forEach(prediction => {
      this.predictions.set(prediction.match_id, prediction);
    });

    this.stats.totalEntries = this.predictions.size;
    const success = this.saveData();
    if (!success) {
      console.error('Failed to persist prediction batch');
    }
    return success;
  }

  getPrediction(matchId: number): PredictionCache | null {
    const prediction = this.predictions.get(matchId);
    if (!prediction) {
      this.stats.misses += 1;
      return null;
    }

    if (new Date(prediction.expiry_time) <= new Date()) {
      this.predictions.delete(matchId);
      this.stats.expired += 1;
      this.stats.misses += 1;
      this.persistAfterExpiryRemoval();
      return null;
    }

    this.stats.hits += 1;
    return prediction;
  }

  getPredictionsByIds(matchIds: number[]): PredictionCache[] {
    const now = new Date();
    const results: PredictionCache[] = [];
    let expiredRemoved = 0;

    matchIds.forEach(matchId => {
      const prediction = this.predictions.get(matchId);
      if (!prediction) {
        this.stats.misses += 1;
        return;
      }

      if (new Date(prediction.expiry_time) <= now) {
        this.predictions.delete(matchId);
        expiredRemoved += 1;
        this.stats.expired += 1;
        this.stats.misses += 1;
        return;
      }

      this.stats.hits += 1;
      results.push(prediction);
    });

    if (expiredRemoved > 0) {
      console.info(`JSONCache removed ${expiredRemoved} expired entries during batch lookup.`);
      this.persistAfterExpiryRemoval();
    }

    return results;
  }

  getHighConfidencePredictions(minConfidence: number = 75): PredictionCache[] {
    const now = new Date();
    let expiredRemoved = 0;
    const predictions = Array.from(this.predictions.values())
      .filter(prediction => {
        if (new Date(prediction.expiry_time) <= now) {
          this.predictions.delete(prediction.match_id);
          this.stats.expired += 1;
          expiredRemoved += 1;
          return false;
        }
        return prediction.confidence_score >= minConfidence;
      })
      .sort((a, b) => b.confidence_score - a.confidence_score);

    if (expiredRemoved > 0) {
      this.persistAfterExpiryRemoval();
    }

    return predictions;
  }

  saveAnalysisLog(log: Omit<AnalysisLog, 'id'>): number {
    const newLog: AnalysisLog = {
      id: this.nextLogId++,
      ...log,
      run_time: log.run_time || new Date().toISOString()
    };

    this.logs.unshift(newLog);
    this.logs = this.logs.slice(0, 100);

    const success = this.saveData({ skipCleanup: true });
    if (!success) {
      console.error('Failed to persist analysis log entry');
    }

    return newLog.id;
  }

  getAnalysisLogs(limit: number = 10): AnalysisLog[] {
    return this.logs.slice(0, limit);
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }
}

export const cache = new JSONCache();
