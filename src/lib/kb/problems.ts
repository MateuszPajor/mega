// What #4471 actually holds, problem by problem. Pages explain it; this file is what runs.
//
// Counted with the desk's own view (causes.ts): a report is placed by its tenant, `parser` or
// `hint`, and stays counted where it is filed. The desk has also read some bodies
// (desk-notes.json): `oneDayMove` reports describe a date that slid by one day, not a day and
// month swapped. That is a problem of its own, with its own ticket. Like the desk's footnote,
// those reports are still counted where they are filed, so they appear in two rows.
import { causeOf, uniqueById, type Report, type Tenant } from '#lib/kb/causes';

export type Problem = 'parser' | 'hint' | 'one-day';
export const PROBLEMS: readonly Problem[] = ['parser', 'hint', 'one-day'];

export type DeskNotes = { oneDayMove: readonly string[] };

export type ProblemGroup = {
  problem: Problem | 'unplaced';
  reports: Report[];
  // What intake tagged these reports as: tag → count.
  taggedAs: Record<string, number>;
  tenants: number;
  firstSeen: string;
  lastSeen: string;
  // For a problem read from the bodies: the cause rows its reports are also counted under.
  alsoFiledUnder: string[];
};

export type Split = {
  rows: number; // rows in the export, duplicates included
  unique: number; // reports merged into the ticket, one per id
  groups: ProblemGroup[];
};

function group(problem: ProblemGroup['problem'], rs: Report[], alsoFiledUnder: string[] = []): ProblemGroup {
  const days = rs.map((r) => r.receivedAt.slice(0, 10)).sort();
  return {
    problem,
    reports: rs,
    taggedAs: rs.reduce<Record<string, number>>((n, r) => ({ ...n, [r.meta.intakeTag]: (n[r.meta.intakeTag] ?? 0) + 1 }), {}),
    tenants: new Set(rs.map((r) => r.tenant)).size,
    firstSeen: days[0],
    lastSeen: days[days.length - 1],
    alsoFiledUnder,
  };
}

export function splitTicket(
  reports: Report[],
  ticket: number,
  tenantOf: (r: Report) => Tenant | undefined,
  notes: DeskNotes,
): Split {
  const rows = reports.filter((r) => r.mergedInto === ticket);
  const merged = uniqueById(rows);

  // By cause, as the desk files them.
  const byCause = new Map<ProblemGroup['problem'], Report[]>();
  for (const r of merged) {
    const c = causeOf(r, tenantOf(r)) ?? 'unplaced';
    byCause.set(c, [...(byCause.get(c) ?? []), r]);
  }
  const groups = [...byCause.entries()].map(([c, rs]) => group(c, rs)).sort((a, b) => b.reports.length - a.reports.length);

  // Read from the bodies: counted again here, footnoted with where they are filed.
  const oneDay = merged.filter((r) => notes.oneDayMove.includes(r.id));
  if (oneDay.length) {
    const filed = [...new Set(oneDay.map((r) => causeOf(r, tenantOf(r)) ?? 'unplaced'))];
    groups.push(group('one-day', oneDay, filed));
  }
  return { rows: rows.length, unique: merged.length, groups };
}
