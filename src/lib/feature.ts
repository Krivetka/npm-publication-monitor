// A fired feature: what fired, with which value and threshold, and its weight in the score.

export interface Feature {
  id: string;
  lane: string;
  weight: number;
  value: number | string | boolean | string[];
  threshold?: number;
  detail?: Record<string, unknown>;
}

export const scoreOf = (features: Feature[]): number => features.reduce((s, f) => s + f.weight, 0);

// One feature per id; when it fires on several versions of the event, the versions are collected in detail.
export class FeatureSet {
  private readonly byId = new Map<string, Feature>();

  add(f: Feature, version?: string): void {
    const existing = this.byId.get(f.id);
    if (!existing) {
      this.byId.set(f.id, version ? { ...f, detail: { ...f.detail, versions: [version] } } : f);
      return;
    }
    if (version) {
      const versions = (existing.detail?.versions as string[] | undefined) ?? [];
      if (!versions.includes(version)) versions.push(version);
      existing.detail = { ...existing.detail, versions };
    }
  }

  list(): Feature[] {
    return [...this.byId.values()];
  }
}
