import { escapeHtml, fmtShort } from '../engine/format';
import { ChartSpec } from '../reportCenter.types';

/** Same series colours as the in-app chart. */
export const CHART_COLORS = ['#1f4e78', '#2e9d5b', '#e08a1e', '#c0392b', '#7b4fb0'];

const W = 1400;
const H = 250;
const PAD = { left: 64, right: 16, top: 16, bottom: 64 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/**
 * The report's chart as inline SVG for the template view and the PDF (no browser
 * scripting needed). Bars are grouped per category; lines get a dot per point.
 */
export function chartSvg(chart: ChartSpec): string {
  const all = chart.series.flatMap((s) => s.values);
  if (!chart.categories.length || !all.length) return '';
  const minV = Math.min(0, ...all);
  const maxV = niceMax(Math.max(...all, 0));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - minV) / (maxV - minV || 1)) * plotH;
  const n = chart.categories.length;
  const step = plotW / n;
  const parts: string[] = [];

  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) * i) / 4;
    parts.push(
      `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e7ec"/>`,
      `<text x="${PAD.left - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#5b6470">${fmtShort(v)}</text>`,
    );
  }

  const every = Math.ceil(n / 24);
  chart.categories.forEach((c, i) => {
    if (i % every) return;
    const x = PAD.left + step * (i + 0.5);
    const label = escapeHtml(c.length > 18 ? c.slice(0, 17) + '…' : c);
    parts.push(
      n > 8
        ? `<text transform="translate(${x},${H - PAD.bottom + 10}) rotate(-40)" text-anchor="end" font-size="10" fill="#5b6470">${label}</text>`
        : `<text x="${x}" y="${H - PAD.bottom + 16}" text-anchor="middle" font-size="10" fill="#5b6470">${label}</text>`,
    );
  });

  if (chart.type === 'bar') {
    const groupW = step * 0.72;
    const barW = groupW / chart.series.length;
    chart.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = PAD.left + step * i + (step - groupW) / 2 + barW * si;
        const top = Math.min(y(v), y(0));
        const h = Math.max(Math.abs(y(0) - y(v)), v ? 1 : 0);
        parts.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(barW - 1, 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${CHART_COLORS[si % 5]}"/>`);
      });
    });
  } else {
    chart.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${(PAD.left + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${CHART_COLORS[si % 5]}" stroke-width="2"/>`);
      pts.forEach((pt) => {
        const [cx, cy] = pt.split(',');
        parts.push(`<circle cx="${cx}" cy="${cy}" r="2.5" fill="${CHART_COLORS[si % 5]}"/>`);
      });
    });
  }

  const legend = chart.series
    .map((s, si) => `<span class="lg"><i style="background:${CHART_COLORS[si % 5]}"></i>${escapeHtml(s.name)}</span>`)
    .join('');
  return `<div class="chart"><div class="chart-title">${escapeHtml(chart.title)}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${parts.join('')}</svg>
    <div class="legend">${legend}</div></div>`;
}
