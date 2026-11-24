// Event rate per key in a sliding window and its deviation from the baseline of the preceding
// history (a day by default) in units of standard deviation. Time is in minutes; per-key data
// is stored sparsely (minute → counter), so hundreds of thousands of rare keys are cheap.

export interface RateStats {
  current: number; // events in the window ending at the current minute
  mean: number; // mean over non-overlapping windows of the same length in the history
  std: number;
  z: number; // (current - mean) / max(std, stdFloor)
  windows: number; // how many history windows the journal covers
}

interface KeyState {
  buckets: Map<number, number>;
  baseMinute: number;
  baseWindows: number;
  mean: number;
  std: number;
}

export class WindowRate {
  readonly windowMin: number;
  readonly historyMin: number;
  // lower bound of the denominator: rare keys have std≈0, and without it z explodes
  readonly stdFloor: number;
  private readonly keys = new Map<string, KeyState>();

  constructor(windowMin: number, historyMin: number, stdFloor: number) {
    this.windowMin = windowMin;
    this.historyMin = historyMin;
    this.stdFloor = stdFloor;
  }

  get size(): number {
    return this.keys.size;
  }

  add(key: string, minute: number, amount = 1): void {
    let st = this.keys.get(key);
    if (!st) {
      st = { buckets: new Map(), baseMinute: -1, baseWindows: 0, mean: 0, std: 0 };
      this.keys.set(key, st);
    }
    st.buckets.set(minute, (st.buckets.get(minute) ?? 0) + amount);
  }

  // firstMinute — the first minute of the journal: history windows before it are not counted
  stats(key: string, minute: number, firstMinute: number): RateStats {
    const st = this.keys.get(key);
    const w = this.windowMin;
    let current = 0;
    if (st) for (let i = 0; i < w; i++) current += st.buckets.get(minute - i) ?? 0;

    const baseEnd = minute - w;
    const covered = Math.max(0, baseEnd - firstMinute + 1);
    const windows = Math.min(Math.floor(this.historyMin / w), Math.floor(covered / w));
    if (windows === 0) return { current, mean: 0, std: 0, z: 0, windows: 0 };

    let mean = 0;
    let std = 0;
    if (st && st.baseMinute === minute && st.baseWindows === windows) {
      mean = st.mean;
      std = st.std;
    } else if (st) {
      // the baseline depends only on past minutes, so it is computed once per minute per key
      const perWindow = new Map<number, number>();
      for (const [m, c] of st.buckets) {
        const off = baseEnd - m;
        if (off < 0 || off >= windows * w) continue;
        const idx = Math.floor(off / w);
        perWindow.set(idx, (perWindow.get(idx) ?? 0) + c);
      }
      let sum = 0;
      let sumSq = 0;
      for (const c of perWindow.values()) {
        sum += c;
        sumSq += c * c;
      }
      mean = sum / windows;
      std = Math.sqrt(Math.max(0, sumSq / windows - mean * mean));
      st.baseMinute = minute;
      st.baseWindows = windows;
      st.mean = mean;
      st.std = std;
    }
    return { current, mean, std, z: (current - mean) / Math.max(std, this.stdFloor), windows };
  }

  prune(minute: number): void {
    const oldest = minute - this.windowMin - this.historyMin + 1;
    for (const [key, st] of this.keys) {
      for (const m of st.buckets.keys()) if (m < oldest) st.buckets.delete(m);
      if (st.buckets.size === 0) this.keys.delete(key);
    }
  }
}
