"use client";
// Einfacher Rückblick-Chart: Kursverlauf mit den Zonen von Blacktrader (grün = Kauf, rot = Short, blau = Kernposition)
// und ✓ (Zone hat gehalten) bzw. ✗ (gescheitert).
import type { EchoZone } from "@/lib/analysis/echoZones";
import type { Candle } from "@/lib/types";

const FILL = { trade: "rgba(52,211,153,0.25)", short: "rgba(248,113,113,0.25)", core: "rgba(56,189,248,0.25)" };
const LINE = { trade: "#34d399", short: "#f87171", core: "#38bdf8" };

export function ZoneHistoryChart({ candles, zones, height = 200 }: { candles: Candle[]; zones: EchoZone[]; height?: number }) {
  if (candles.length < 5) return null;
  const every = Math.max(1, Math.ceil(candles.length / 320));
  const data = candles.filter((_, i) => i % every === 0 || i === candles.length - 1);
  const W = 360;
  const H = height;
  const pad = 6;
  const shown = zones.slice(-40);
  const lo = Math.min(...data.map((c) => c.low), ...shown.map((z) => Math.min(z.top, z.bottom)));
  const hi = Math.max(...data.map((c) => c.high), ...shown.map((z) => Math.max(z.top, z.bottom)));
  const t0 = data[0].time;
  const t1 = data[data.length - 1].time;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (W - 2 * pad) + pad;
  const y = (p: number) => pad + (1 - (p - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const path = data.map((c, i) => `${i ? "L" : "M"}${x(c.time).toFixed(1)},${y(c.close).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label="Kursverlauf mit Zonen">
      {shown.map((z) => {
        const x1 = x(z.t);
        const x2 = Math.max(x1 + 3, x(z.at));
        const yt = Math.min(y(z.top), y(z.bottom));
        const h = Math.max(3, Math.abs(y(z.top) - y(z.bottom)));
        return <rect key={`${z.kind}${z.t}`} x={x1} y={yt} width={x2 - x1} height={h} fill={FILL[z.kind]} stroke={LINE[z.kind]} strokeWidth="0.6" rx="1.5" />;
      })}
      <path d={path} fill="none" stroke="#d6c08a" strokeWidth="1.4" />
      {shown.map((z) => (
        <text key={`m${z.kind}${z.t}`} x={x(z.at)} y={Math.max(11, Math.min(y(z.top), y(z.bottom)) - 3)} fontSize="11" fontWeight="700" textAnchor="middle" fill={z.ok ? "#34d399" : "#f87171"}>
          {z.ok ? "✓" : "✗"}
        </text>
      ))}
    </svg>
  );
}
