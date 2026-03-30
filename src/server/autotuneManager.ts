import fs from 'fs';
import path from 'path';
import { deepMerge, runOptimization } from './optimizer';

export function loadBestParams(config: any, filePath?: string) {
  try {
    const p = filePath || config.autoTune?.bestParamsFile || path.join(process.cwd(), 'logs/best_params.json');
    if (!fs.existsSync(p)) return { loaded: false, path: p };
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw || '{}');
    if (!obj?.patch) return { loaded: false, path: p };
    deepMerge(config, obj.patch);
    return { loaded: true, path: p, generatedAt: obj.generatedAt, metrics: obj.metrics };
  } catch (e: any) {
    return { loaded: false, error: e.message };
  }
}

export function scheduleOptimization(config: any, logger: any) {
  const at = config.autoTune || {};
  if (!at.enabled || !at.scheduleHours) return null;

  const hours = Number(at.scheduleHours || 24);
  const intervalMs = Math.max(1, hours) * 3600 * 1000;

  const runOnce = async () => {
    const inFile = at.marketFile || path.join(process.cwd(), 'logs/market.jsonl');
    const outFile = at.bestParamsFile || path.join(process.cwd(), 'logs/best_params.json');
    const iters = Number(at.iterations || 80);

    const log = (level: string, msg: string) => {
      if (typeof logger === 'function') logger(msg, level.toUpperCase() as any);
      else if (logger && typeof logger[level] === 'function') logger[level](msg);
      else console.log(msg);
    };

    try {
      log('info', `[AutoTune] Starting optimization with ${iters} iterations...`);
      
      // Backup settings before applying new ones
      if (typeof (config as any).backupSettings === 'function') {
        (config as any).backupSettings();
      } else {
        // Fallback if bot instance is not passed directly but just settings object
        // In our case, the bot instance is what holds the settings and the backup method
      }

      const result = await runOptimization(inFile, outFile, iters);
      log('info', `[AutoTune] Optimization finished. Score: ${result.objectiveScore.toFixed(2)}`);
      
      if (at.autoApply) {
        const r = loadBestParams(config, outFile);
        if (r.loaded) log('info', `[AutoTune] Applied patch from ${outFile}`);
      }
    } catch (e: any) {
      log('error', `[AutoTune] Optimization failed: ${e.message}`);
    }
  };

  if (at.runOnStart) runOnce();

  return setInterval(runOnce, intervalMs);
}
