import type { VNode } from 'preact';

export interface Finding {
  seq: number;
  verdict: string;
  note?: string;
  reference?: string;
  decided_at: string;
}
export interface VerdictClient {
  putFinding(seq: number, body: { verdict: string; note?: string; reference?: string }): Promise<Finding>;
  deleteFinding(seq: number): Promise<null>;
}
export function VerdictForm(props: {
  seq: number;
  finding: Finding | null;
  onSaved: (finding: Finding | null) => void;
  client?: VerdictClient;
  tokens?: { get(): string; set(token: string): void };
}): VNode;
