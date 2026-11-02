// Renders one kb page to static HTML, the way the desk sees it, without a SvelteKit build.
// It runs the kb's own logic (src/lib/kb/*.ts, via Node's type stripping) and mirrors the
// markup of runbook.svelte and the components the page uses.
//
//   node tools/render-page.mjs src/routes/kb/incidents/4471-split/+page.svx rendered/kb/incidents/4471-split/index.html
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const lib = pathToFileURL(path.join(root, 'src/lib/')).href;

// '#lib/kb/x' → src/lib/kb/x.ts (the alias the kb uses).
register(
  'data:text/javascript,' +
    encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('#lib/')) return next(${JSON.stringify(lib)} + spec.slice(5) + (/\\.\\w+$/.test(spec) ? '' : '.ts'), ctx);
    return next(spec, ctx);
  }`),
);

const { uniqueById, groupByCause, ticketCause, readAs } = await import('#lib/kb/causes');
const { splitTicket } = await import('#lib/kb/problems');
const { deskRef } = await import('#lib/kb/desk-ref');
const { daysSince, isoDay, STALE_AFTER_DAYS } = await import('#lib/kb/staleness');

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const reports = readJson('src/lib/data/reports-4471.json');
const notes = readJson('src/lib/data/desk-notes.json');
const tdir = path.join(root, 'src/lib/data/tenants');
const byHandle = new Map(
  fs.readdirSync(tdir).map((f) => JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'))).map((t) => [t.handle, t]),
);
const tenantOf = (r) => byHandle.get(r.tenant);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tags = (g) =>
  Object.entries(g.taggedAs)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ×${n}`)
    .join(' · ');

// ---- page source
const [srcPath, outPath] = process.argv.slice(2);
const src = fs.readFileSync(path.join(root, srcPath), 'utf8');
const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
const meta = Object.fromEntries(
  fm[1].split('\n').map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^'(.*)'$/, '$1')];
  }),
);
let body = src.slice(fm[0].length);
const script = /<script>([\s\S]*?)<\/script>/.exec(body);
const issuesMatch = script && /const issues = (\{[\s\S]*?\});/.exec(script[1]);
const issues = issuesMatch ? Function(`return ${issuesMatch[1]}`)() : {};
body = body.replace(/<script>[\s\S]*?<\/script>/, '');

// ---- components (markup mirrors the .svelte files)
const components = {
  ProblemTable({ ticket }) {
    const s = splitTicket(reports, ticket, tenantOf, notes);
    const total = s.groups.reduce((n, g) => n + g.reports.length, 0);
    const link = (p) =>
      issues[p] ? `<a href="${esc(issues[p])}">${esc(issues[p].replace(/^.*\/issues\//, '#'))}</a>` : '<span class="none">no ticket</span>';
    return `<p class="sum"><strong>${s.unique}</strong> reports merged into #${ticket} (${s.rows} rows in the export, ${s.rows - s.unique} of them repeats) · <strong>${s.groups.length}</strong> ${s.groups.length === 1 ? 'problem' : 'problems'}</p>
<table><thead><tr><th>problem</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th>ticket</th></tr></thead><tbody>
${s.groups.map((g) => `<tr><td><code>${g.problem}</code></td><td>${g.reports.length}</td><td class="tags">${esc(tags(g))}</td><td>${g.tenants}</td><td>${g.firstSeen} → ${g.lastSeen}</td><td>${link(g.problem)}</td></tr>`).join('\n')}
</tbody><tfoot><tr><td>total</td><td>${total}</td><td colspan="4"></td></tr></tfoot></table>`;
  },
  CauseTable({ ticket }) {
    const merged = uniqueById(reports).filter((r) => r.mergedInto === ticket);
    const groups = groupByCause(merged, tenantOf);
    const owner = ticketCause(groups, ticket);
    const rows = groups
      .map(
        (g) =>
          `<tr${g.cause !== owner ? ' class="wrong"' : ''}><td><code>${g.cause}</code></td><td>${g.reports.length}</td><td class="tags">${esc(tags(g))}</td><td>${g.tenants}</td><td>${g.firstSeen} → ${g.lastSeen}</td><td>${g.cause === owner ? `#${ticket}` : 'not this ticket — no ticket of its own'}</td></tr>`,
      )
      .join('\n');
    const foot = groups
      .map((g) => [g, readAs(g, notes.oneDayMove)])
      .filter(([, n]) => n)
      .map(([g, n]) => `<p class="note">${n} reports read as a one-day move; filed under <code>${g.cause}</code> by tenant.</p>`)
      .join('\n');
    return `<p class="sum"><strong>${merged.length}</strong> reports merged into #${ticket} · <strong>${groups.length}</strong> ${groups.length === 1 ? 'cause' : 'causes'}</p>
<table class="causes"><thead><tr><th>cause</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th></th></tr></thead><tbody>
${rows}
</tbody></table>
${foot}`;
  },
  RenderStamp() {
    return meta.signature
      ? `<p class="stamp">desk ref <b>${deskRef(meta.signature)}</b></p>`
      : `<p class="stamp missing">no desk ref: this page isn't signed (no <code>signature</code> in its frontmatter)</p>`;
  },
};

// ---- tiny Markdown for what kb pages use: headings, paragraphs, lists, bold, italics, code, links
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function markdown(text) {
  const out = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const b = block.trim();
    let m;
    if ((m = /^<(\w+)\s*(.*?)\s*\/>$/s.exec(b))) {
      const props = {};
      for (const [, k, v] of m[2].matchAll(/(\w+)=\{(\d+)\}/g)) props[k] = Number(v);
      out.push(components[m[1]](props));
    } else if ((m = /^<Callout(?:\s+kind="(\w+)")?>([\s\S]*)<\/Callout>$/.exec(b))) {
      out.push(`<aside class="${m[1] ?? 'note'}">${inline(m[2].trim())}</aside>`);
    } else if ((m = /^(#{2,3}) (.*)$/.exec(b))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^(- |\d+\. )/.test(b)) {
      const tag = b.startsWith('- ') ? 'ul' : 'ol';
      const items = b.split(/\n(?=- |\d+\. )/).map((i) => `<li>${inline(i.replace(/^(- |\d+\. )/, '').replace(/\n\s*/g, ' '))}</li>`);
      out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else {
      out.push(`<p>${inline(b.replace(/\n\s*/g, ' '))}</p>`);
    }
  }
  return out.join('\n');
}

const age = daysSince(meta.reviewed);
const stale = age > STALE_AFTER_DAYS;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} · support kb</title>
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8; --accent: #2f6f5e; --warn: #b4501f; --warn-bg: #fbeee6; --note-bg: #eef5f2; --mono: ui-monospace, 'Cascadia Code', Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #171716; --fg: #ecebe6; --muted: #9c9a93; --line: #34332f; --accent: #6fbfa6; --warn: #f0905d; --warn-bg: #3a2418; --note-bg: #1d2c27; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
.kb table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
.kb th, .kb td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.5rem; text-align: left; }
.kb code { font-family: var(--mono); font-size: 0.88em; }
.kb a { color: var(--accent); }
.kb { max-width: 760px; margin: 0 auto; padding: 2rem 16px 4rem; }
.crumb { font: 0.8rem var(--mono); text-decoration: none; color: var(--muted); }
h1 { margin: 0.25rem 0 0.5rem; line-height: 1.2; }
.meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--muted); font-size: 0.85rem; margin: 0; }
.status { border: 1px solid var(--line); border-radius: 99px; padding: 0 0.6rem; }
.stale { color: var(--warn); font-weight: 600; }
.banner { background: var(--warn-bg); color: var(--warn); padding: 0.6rem 1rem; border-radius: 6px; }
footer { margin-top: 3rem; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
aside { border-left: 4px solid var(--accent); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--note-bg); }
aside.warn { border-color: var(--warn); background: var(--warn-bg); }
.sum { font-size: 1.1rem; }
.tags, .note { color: var(--muted); font-size: 0.85em; }
.none { color: var(--warn); font-weight: 600; }
tfoot td { font-weight: 600; }
.causes .wrong td { background: var(--warn-bg); }
.causes .wrong td:last-child { color: var(--warn); font-weight: 600; }
.kb table { display: block; overflow-x: auto; }
.stamp { margin: 2rem 0 0; font: 0.85rem var(--mono); color: var(--muted); }
.stamp b { color: var(--accent); letter-spacing: 0.04em; }
.missing { color: var(--warn); }
</style>
</head>
<body>
<div class="kb">
<header>
<a class="crumb" href="/kb">support desk · kb</a>
<h1>${esc(meta.title)}</h1>
<p class="meta"><span>owner <b>${esc(meta.owner)}</b></span> <span class="status ${esc(meta.status)}">${esc(meta.status)}</span> <span${stale ? ' class="stale"' : ''}>reviewed ${isoDay(meta.reviewed)} · ${age} days ago${stale ? ' · stale' : ''}</span></p>
</header>
${stale ? `<p class="banner">Nobody has re-read this page in ${age} days. Check it against the live views before you rely on it.</p>` : ''}
<main>
${markdown(body)}
</main>
<footer>Pages are written by people. Tables and charts are built from data at render time.</footer>
</div>
</body>
</html>
`;
fs.mkdirSync(path.dirname(path.join(root, outPath)), { recursive: true });
fs.writeFileSync(path.join(root, outPath), html);
console.log('wrote', outPath);
