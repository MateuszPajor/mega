// What #4471 actually holds, problem by problem. Pages explain it; this file is what runs.
//
// causes.ts places a report by its tenant: `parser` or `hint`. That is right for most reports,
// but the desk has also read some bodies (desk-notes.json): `oneDayMove` reports describe a date
// that slid by one day, not a day and month swapped. No parser or hint fix touches them, so here
// they are their own problem, not a footnote under `parser`.
import { causeOf, uniqueById, type Report, type Tenant } from '#lib/kb/causes';

export type Problem = 'parser' | 'hint' | 'one-day';
export const PROBLEMS: readonly Problem[] = ['parser', 'hint', 'one-day'];

export type DeskNotes = { oneDayMove: readonly string[] };

export function problemOf(r: Report, t: Tenant | undefined, notes: DeskNotes): Problem | null {
  if (notes.oneDayMove.includes(r.id)) return 'one-day';
  return causeOf(r, t);
}

export type ProblemGroup = {
  problem: Problem | 'unplaced';
  reports: Report[];
  // What intake tagged these reports as: tag → count.
  taggedAs: Record<string, number>;
  tenants: number;
  firstSeen: string;
  lastSeen: string;
};

export type Split = {
  rows: number; // rows in the export, duplicates included
  unique: number; // reports merged into the ticket, one per id
  groups: ProblemGroup[];
};

export function splitTicket(
  reports: Report[],
  ticket: number,
  tenantOf: (r: Report) => Tenant | undefined,
  notes: DeskNotes,
): Split {
  const rows = reports.filter((r) => r.mergedInto === ticket);
  const merged = uniqueById(rows);
  const byProblem = new Map<ProblemGroup['problem'], Report[]>();
  for (const r of merged) {
    const p = problemOf(r, tenantOf(r), notes) ?? 'unplaced';
    byProblem.set(p, [...(byProblem.get(p) ?? []), r]);
  }
  const groups = [...byProblem.entries()]
    .map(([problem, rs]) => {
      const days = rs.map((r) => r.receivedAt.slice(0, 10)).sort();
      return {
        problem,
        reports: rs,
        taggedAs: rs.reduce<Record<string, number>>((n, r) => ({ ...n, [r.meta.intakeTag]: (n[r.meta.intakeTag] ?? 0) + 1 }), {}),
        tenants: new Set(rs.map((r) => r.tenant)).size,
        firstSeen: days[0],
        lastSeen: days[days.length - 1],
      };
    })
    .sort((a, b) => b.reports.length - a.reports.length);
  return { rows: rows.length, unique: merged.length, groups };
}
