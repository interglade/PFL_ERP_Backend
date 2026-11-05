import { changePct, escapeHtml, fmtCell, fmtKpi, isNumeric } from '../engine/format';
import { ReportResult, TableRow } from '../reportCenter.types';
import { chartSvg } from './svgChart';

const CSS = (landscape: boolean) => `
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm 9mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1d2733; font-size: 8.6pt; margin: 0; }
  .sheet { background: #fff; }
  @media screen {
    html { background: #e9edf2; }
    .sheet { width: ${landscape ? '297mm' : '210mm'}; min-height: ${landscape ? '210mm' : '297mm'}; margin: 16px auto; padding: 10mm 9mm;
             box-shadow: 0 2px 10px rgba(0,0,0,.18); }
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f4e78; padding-bottom: 6px; }
  .co { display: flex; gap: 10px; align-items: center; }
  .co img { height: 40px; }
  .co-name { font-size: 13pt; font-weight: 700; color: #1f4e78; }
  .co-sub { color: #5b6470; font-size: 7.6pt; max-width: 120mm; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 13pt; }
  .title .code { color: #5b6470; font-size: 7.6pt; }
  .params { display: grid; grid-template-columns: repeat(${landscape ? 4 : 3}, 1fr); gap: 2px 14px; margin: 6px 0; padding: 5px 7px;
            background: #f3f6f9; border: 1px solid #dde3ea; border-radius: 3px; font-size: 7.8pt; }
  .params b { color: #5b6470; font-weight: 600; }
  .party { border: 1px solid #dde3ea; border-radius: 3px; padding: 6px 8px; margin: 6px 0; }
  .party .t { color: #5b6470; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .4px; }
  .party .n { font-size: 11pt; font-weight: 700; }
  .kpis { display: flex; gap: 6px; margin: 6px 0; }
  .kpi { flex: 1; border: 1px solid #dde3ea; border-radius: 3px; padding: 5px 7px; }
  .kpi .l { color: #5b6470; font-size: 7.4pt; }
  .kpi .v { font-size: 11pt; font-weight: 700; }
  .kpi .c { font-size: 7.2pt; }
  .up { color: #2e7d32; } .down { color: #c0392b; } .flat { color: #5b6470; }
  .chart { margin: 4px 0 6px; break-inside: avoid; }
  .chart-title { font-weight: 600; font-size: 8.4pt; margin-bottom: 2px; }
  .legend { display: flex; gap: 12px; font-size: 7.6pt; color: #5b6470; }
  .lg i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #1f4e78; color: #fff; font-weight: 600; text-align: left; padding: 4px 4px; font-size: 7.8pt; vertical-align: bottom; }
  td { padding: 2.5px 4px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
  th.n, td.n { text-align: right; white-space: nowrap; }
  tr { break-inside: avoid; }
  tr.group td { background: #e8eef5; font-weight: 700; color: #1f4e78; break-after: avoid; }
  tr.group.l1 td { background: #f1f5f9; }
  tr.subtotal td { background: #f6f8fa; font-weight: 700; border-top: 1px solid #c9d3de; }
  tr.total td { background: #dde6ef; font-weight: 800; border-top: 2px solid #1f4e78; }
  tr.opening td, tr.closing td { background: #f3f6f9; font-weight: 700; }
  td.neg { color: #c0392b; }
  .notes { margin-top: 8px; color: #5b6470; font-size: 7.4pt; }
  .notes li { margin: 1px 0; }
  .warn { margin: 6px 0; padding: 5px 7px; background: #fff6e5; border: 1px solid #f0d49a; border-radius: 3px; font-size: 7.8pt; }
  .foot { display: none; }
  @media screen { .foot { display: block; margin-top: 10px; color: #8a939e; font-size: 7.4pt; border-top: 1px solid #edf0f3; padding-top: 4px; } }
`;

function rowHtml(r: TableRow, visible: ReportResult['columns']): string {
  if (r.kind === 'group') {
    return `<tr class="group l${r.level}"><td colspan="${visible.length}" style="padding-left:${4 + r.level * 10}px">${escapeHtml(r.label)}</td></tr>`;
  }
  const cells = visible.map((c, i) => {
    const v = r.cells[c.key];
    let text = fmtCell(v, c.type);
    if (i === 0 && r.kind !== 'detail') text = escapeHtml(r.label ?? '');
    else text = escapeHtml(text);
    const num = isNumeric(c.type);
    const neg = num && typeof v === 'number' && v < 0 ? ' neg' : '';
    const indent = i === 0 ? ` style="padding-left:${4 + r.level * 10}px"` : '';
    return `<td class="${num ? 'n' : ''}${neg}"${indent}>${text}</td>`;
  });
  return `<tr class="${r.kind}">${cells.join('')}</tr>`;
}

/**
 * The report as a printable HTML page. The in-app Template view shows exactly this HTML,
 * and the PDF is this HTML printed by Chromium, so they always match.
 */
export function reportHtml(r: ReportResult): string {
  const landscape = r.layout.orientation === 'landscape';
  const visible = r.columns.filter((c) => !c.excelOnly);
  const co = r.company;

  const kpis = r.kpis.length
    ? `<div class="kpis">${r.kpis
        .map((k) => {
          const ch = changePct(k.value, k.previous);
          let cmp = '';
          if (ch !== null) {
            const good = k.higherIsBetter === false ? ch < 0 : ch > 0;
            cmp = `<div class="c ${ch === 0 ? 'flat' : good ? 'up' : 'down'}">${ch > 0 ? '▲' : ch < 0 ? '▼' : '='} ${Math.abs(ch)}% vs previous period</div>`;
          } else if (k.hint) {
            cmp = `<div class="c flat">${escapeHtml(k.hint)}</div>`;
          }
          return `<div class="kpi"><div class="l">${escapeHtml(k.label)}</div><div class="v">${escapeHtml(fmtKpi(k.value, k.type))}</div>${cmp}</div>`;
        })
        .join('')}</div>`
    : '';

  const party = r.party
    ? `<div class="party"><div class="t">${escapeHtml(r.party.title)}</div><div class="n">${escapeHtml(r.party.name)}</div>${r.party.lines
        .map((l) => `<div>${escapeHtml(l)}</div>`)
        .join('')}</div>`
    : '';

  const body = r.rows.map((row) => rowHtml(row, visible)).join('');
  const empty = r.rows.length ? '' : `<tr><td colspan="${visible.length}" style="text-align:center;padding:14px;color:#5b6470">No records for these filters</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.title)}</title><style>${CSS(landscape)}</style></head>
<body><div class="sheet">
  <div class="head">
    <div class="co">${co?.logo ? `<img src="${escapeHtml(co.logo)}" alt="">` : ''}
      <div><div class="co-name">${escapeHtml(co?.name ?? 'Prime Fresh')}</div>
      <div class="co-sub">${escapeHtml(co?.address ?? '')}${co?.gstNo ? ` · GSTIN ${escapeHtml(co.gstNo)}` : ''}</div></div></div>
    <div class="title"><h1>${escapeHtml(r.title)}</h1><div class="code">${escapeHtml(r.typeLabel)} · ${escapeHtml(r.code)}</div></div>
  </div>
  <div class="params">${r.paramsSummary.map((p) => `<div><b>${escapeHtml(p.label)}:</b> ${escapeHtml(p.value)}</div>`).join('')}</div>
  ${party}
  ${kpis}
  ${r.chart ? chartSvg(r.chart) : ''}
  ${r.truncated ? `<div class="warn">This report was too large to show in full. Narrow the filters, use "Summary only", or download Excel for every row.</div>` : ''}
  <table><thead><tr>${visible.map((c) => `<th class="${isNumeric(c.type) ? 'n' : ''}">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${body}${empty}</tbody></table>
  ${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
  <div class="foot">Generated by ${escapeHtml(r.generatedBy)} on ${escapeHtml(r.generatedAt)}</div>
</div></body></html>`;
}
