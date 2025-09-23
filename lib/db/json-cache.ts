import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data');
const PREDICTIONS_FILE = path.join(CACHE_DIR, 'predictions.json');
const LOGS_FILE = path.join(CACHE_DIR, 'analysis-logs.json');

// Ensure data directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
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

class JSONCache {
  private predictions: Map<number, PredictionCache> = new Map();
  private logs: AnalysisLog[] = [];
  private nextLogId = 1;

  constructor() {
    this.loadData();
  }

  private loadData() {
    // Load predictions
    if (fs.existsSync(PREDICTIONS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf-8'));
        this.predictions = new Map(data.predictions.map((p: PredictionCache) => [p.match_id, p]));
      } catch (error) {
        console.error('Failed to load predictions:', error);
        this.predictions = new Map();
      }
    }

    // Load logs
    if (fs.existsSync(LOGS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
        this.logs = data.logs || [];
        this.nextLogId = (this.logs[0]?.id || 0) + 1;
      } catch (error) {
        console.error('Failed to load logs:', error);
        this.logs = [];
      }
    }
  }

  private saveData() {
    // Save predictions
    const validPredictions = Array.from(this.predictions.values()).filter(
      p => new Date(p.expiry_time) > new Date()
    );

    fs.writeFileSync(
      PREDICTIONS_FILE,
      JSON.stringify({ predictions: validPredictions }, null, 2)
    );

    // Save logs (keep last 100)
    fs.writeFileSync(
      LOGS_FILE,
      JSON.stringify({ logs: this.logs.slice(0, 100) }, null, 2)
    );
  }

  savePrediction(prediction: PredictionCache): boolean {
    try {
      this.predictions.set(prediction.match_id, prediction);
      this.saveData();
      return true;
    } catch (error) {
      console.error('Failed to save prediction:', error);
      return false;
    }
  }

  savePredictionsBatch(predictions: PredictionCache[]): boolean {
    try {
      predictions.forEach(p => {
        this.predictions.set(p.match_id, p);
      });
      this.saveData();
      return true;
    } catch (error) {
      console.error('Failed to save predictions batch:', error);
      return false;
    }
  }

  getPrediction(matchId: number): PredictionCache | null {
    const prediction = this.predictions.get(matchId);
    if (!prediction) return null;

    // Check if expired
    if (new Date(prediction.expiry_time) <= new Date()) {
      this.predictions.delete(matchId);
      return null;
    }

    return prediction;
  }

  getPredictionsByIds(matchIds: number[]): PredictionCache[] {
    const now = new Date();
    return matchIds
      .map(id => this.predictions.get(id))
      .filter((p): p is PredictionCache => {
        if (!p) return false;
        if (new Date(p.expiry_time) <= now) {
          this.predictions.delete(p.match_id);
          return false;
        }
        return true;
      });
  }

  getHighConfidencePredictions(minConfidence: number = 75): PredictionCache[] {
    const now = new Date();
    const predictions = Array.from(this.predictions.values())
      .filter(p => {
        if (new Date(p.expiry_time) <= now) {
          this.predictions.delete(p.match_id);
          return false;
        }
        return p.confidence_score >= minConfidence;
      })
      .sort((a, b) => b.confidence_score - a.confidence_score);

    return predictions;
  }

  cleanExpiredPredictions(): number {
    const now = new Date();
    const initialSize = this.predictions.size;

    Array.from(this.predictions.entries()).forEach(([id, p]) => {
      if (new Date(p.expiry_time) <= now) {
        this.predictions.delete(id);
      }
    });

    const removed = initialSize - this.predictions.size;
    if (removed > 0) {
      this.saveData();
    }

    return removed;
  }

  saveAnalysisLog(log: Omit<AnalysisLog, 'id'>): number {
    const newLog: AnalysisLog = {
      id: this.nextLogId++,
      ...log,
      run_time: log.run_time || new Date().toISOString()
    };

    this.logs.unshift(newLog);
    this.saveData();
    return newLog.id;
  }

  getAnalysisLogs(limit: number = 10): AnalysisLog[] {
    return this.logs.slice(0, limit);
  }
}

// Singleton instance
export const cache = new JSONCache();