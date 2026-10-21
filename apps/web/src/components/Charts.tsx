"use client";
import { useState } from "react";

/**
 * Two single-series charts, so no legend box: the card title names the series.
 * Thin marks (bars <= 24px, 4px rounded data-end, square at the baseline; 2px line, ringed 8px markers),
 * recessive axes, hover tooltips with larger hit targets, and a table view for every chart.
 */

const W = 560;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 30, left: 36 };

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function Tooltip({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.max(90, text.length * 7.4 + 16);
  const left = Math.min(Math.max(x - w / 2, 0), W - w);
  return (
    <g pointerEvents="none">
      <rect x={left} y={y - 38} width={w} height={28} rx={6} fill="var(--text)" />
      <text x={left + w / 2} y={y - 19} textAnchor="middle" fontSize={13} fill="var(--surface)" fontWeight={700}>
        {text}
      </text>
    </g>
  );
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onToggle} aria-expanded={open}>
      {open ? "Show chart" : "Show table"}
    </button>
  );
}

/** Rounded top, square bottom: a bar anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function AdherenceChart({ data }: { data: Array<{ date: string; taken: number; scheduled: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const band = iw / data.length;
  const bw = Math.min(24, band * 0.5);
  const pct = (d: { taken: number; scheduled: number }) => (d.scheduled ? d.taken / d.scheduled : 0);
  const y = (v: number) => PAD.top + ih * (1 - v);
  const avg = data.reduce((s, d) => s + d.taken, 0) / Math.max(1, data.reduce((s, d) => s + d.scheduled, 0));

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h2 style={{ marginBottom: 2 }}>Doses taken, last 7 days</h2>
          <p className="muted small">{Math.round(avg * 100)}% of scheduled doses taken</p>
        </div>
        <TableToggle open={table} onToggle={() => setTable(!table)} />
      </div>
      {table ? (
        <table className="data">
          <thead><tr><th>Day</th><th>Taken</th><th>Scheduled</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.taken}</td><td>{d.scheduled}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Doses taken per day over the last 7 days. ${data.map((d) => `${dayLabel(d.date)} ${d.taken} of ${d.scheduled}`).join(", ")}.`} onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{v * 100}%</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const p = pct(d);
            const h = Math.max(ih * p, p > 0 ? 2 : 0);
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${dayLabel(d.date)}: ${d.taken} of ${d.scheduled}`}>
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent" />
                {h > 0 && <path d={barPath(cx - bw / 2, PAD.top + ih - h, bw, h)} fill="var(--series-1)" opacity={hover === null || hover === i ? 1 : 0.55} />}
                <text x={cx} y={H - 10} textAnchor="middle" fontSize={12} fill="var(--muted)">{i === data.length - 1 ? "Today" : dayLabel(d.date)}</text>
              </g>
            );
          })}
          {hover !== null && (
            <Tooltip x={PAD.left + band * hover + band / 2} y={PAD.top + ih * (1 - pct(data[hover]!)) + 4} text={`${dayLabel(data[hover]!.date)}: ${data[hover]!.taken} of ${data[hover]!.scheduled} doses`} />
          )}
        </svg>
      )}
    </div>
  );
}

export function MoodChart({ data }: { data: Array<{ date: string; mood: number | null }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (iw * i) / Math.max(1, data.length - 1);
  const y = (m: number) => PAD.top + ih * (1 - (m - 1) / 4);
  const pts = data.map((d, i) => ({ ...d, i })).filter((d) => d.mood !== null) as Array<{ date: string; mood: number; i: number }>;
  const path = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i)},${y(p.mood)}`).join("");
  const last = pts.at(-1);

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h2 style={{ marginBottom: 2 }}>Mood, last 7 days</h2>
          <p className="muted small">From daily check-ins, 1 (very low) to 5 (great)</p>
        </div>
        <TableToggle open={table} onToggle={() => setTable(!table)} />
      </div>
      {table ? (
        <table className="data">
          <thead><tr><th>Day</th><th>Mood</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.mood ?? "no check-in"}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Mood per day: ${data.map((d) => `${dayLabel(d.date)} ${d.mood ?? "none"}`).join(", ")}.`} onMouseLeave={() => setHover(null)}>
          {[1, 3, 5].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{v}</text>
            </g>
          ))}
          {data.map((d, i) => (
            <text key={d.date} x={x(i)} y={H - 10} textAnchor={i === data.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={12} fill="var(--muted)">{i === data.length - 1 ? "Today" : dayLabel(d.date)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => (
            <circle key={p.date} cx={x(p.i)} cy={y(p.mood)} r={hover === p.i ? 6 : 4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          ))}
          {last && hover === null && (
            <text x={x(last.i) - 10} y={y(last.mood) - 12} textAnchor="end" fontSize={13} fontWeight={700} fill="var(--text)">{last.mood} / 5</text>
          )}
          {data.map((d, i) => (
            <rect key={d.date} x={x(i) - iw / data.length / 2} y={PAD.top} width={iw / data.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {hover !== null && (
            <Tooltip x={x(hover)} y={data[hover]!.mood ? y(data[hover]!.mood!) : PAD.top + 40} text={`${dayLabel(data[hover]!.date)}: ${data[hover]!.mood ? `mood ${data[hover]!.mood}` : "no check-in"}`} />
          )}
        </svg>
      )}
    </div>
  );
}
