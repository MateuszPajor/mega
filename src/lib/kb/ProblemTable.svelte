<script lang="ts">
  import reports from '#lib/data/reports-4471.json';
  import notes from '#lib/data/desk-notes.json';
  import type { Report } from '#lib/kb/causes';
  import { tenantOf } from '#lib/kb/locales';
  import { splitTicket } from '#lib/kb/problems';

  // issues: problem → link to the ticket filed for it.
  let { ticket, issues = {} }: { ticket: number; issues?: Record<string, string> } = $props();

  const split = $derived(splitTicket(reports as Report[], ticket, tenantOf, notes));
  const tags = (g: { taggedAs: Record<string, number> }) =>
    Object.entries(g.taggedAs)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, n]) => `${tag} ×${n}`)
      .join(' · ');
  const issueNo = (url: string) => url.replace(/^.*\/issues\//, '#');
</script>

<p class="sum">
  <strong>{split.unique}</strong> reports merged into #{ticket}
  ({split.rows} rows in the export, {split.rows - split.unique} of them repeats) ·
  <strong>{split.groups.length}</strong>
  {split.groups.length === 1 ? 'problem' : 'problems'}
</p>

<table>
  <thead>
    <tr><th>problem</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th>ticket</th></tr>
  </thead>
  <tbody>
    {#each split.groups as g (g.problem)}
      <tr>
        <td><code>{g.problem}</code></td>
        <td>{g.reports.length}{g.alsoFiledUnder.length ? '*' : ''}</td>
        <td class="tags">{tags(g)}</td>
        <td>{g.tenants}</td>
        <td>{g.firstSeen} → {g.lastSeen}</td>
        <td>
          {#if issues[g.problem]}<a href={issues[g.problem]}>{issueNo(issues[g.problem])}</a>{:else}<span class="none">no ticket</span>{/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

{#each split.groups.filter((g) => g.alsoFiledUnder.length) as g (g.problem)}
  <p class="note">
    * Read from the bodies. The desk counts these {g.reports.length} reports where they are filed by tenant, under
    {#each g.alsoFiledUnder as c, i (c)}{i ? ', ' : ''}<code>{c}</code>{/each}, as well.
  </p>
{/each}

<style>
  .sum { font-size: 1.1rem; }
  .tags { color: var(--muted); font-size: 0.85em; }
  .note { color: var(--muted); font-size: 0.85em; }
  .none { color: var(--warn); font-weight: 600; }
</style>
