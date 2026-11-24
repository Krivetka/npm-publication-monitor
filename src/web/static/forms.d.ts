export const LIMITS: { name: number; note: number; reference: number; tokenMin: number; scoreMax: number };
export const VERDICTS: string[];
export function normalisePackageName(raw: unknown): string;
export function validatePackageName(raw: unknown): string | null;
export function validateMinScore(raw: unknown): { value: number | null; error: string | null };
export function validateToken(raw: unknown): string | null;
export function validateVerdict(form: { verdict: string; note?: string; reference?: string }): { verdict?: string; note?: string; reference?: string };
export function validateDependencyCount(count: number, max?: number): string | null;
