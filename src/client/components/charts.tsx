/**
 * Charts, built to one set of mark specs:
 *   bars cap at 24px with a 4px rounded top and a square baseline,
 *   lines are 2px, end dots are 8px with a 2px surface ring,
 *   area fills sit at 10% opacity, gridlines are 1px solid and recessive,
 *   two or more series always get a legend, labels stay selective,
 *   and text never wears a series colour.
 */

import { useId, useState } from "react";
import type { MonthFlow } from "@shared/types.js";
import { formatCents, formatCompact } from "@shared/money.js";
import { formatMonth } from "@shared/dates.js";
import { useSize } from "../lib/useSize.js";
import { COLOR, track } from "../lib/present.js";

/* --------------------------------- legend --------------------------------- */

export function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend__item" key={item.label}>
          <span className="swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------- sparkline ------------------------------- */

/**
 * One series over time. No legend: there is only one colour, and the card title
 * already says what is plotted.
 */
export function Sparkline({
  values, color = COLOR.in, height = 48, caption,
}: { values: number[]; color?: string; height?: number; caption: string }) {
  const [ref, width] = useSize<HTMLDivElement>();

  const inset = 6; // room for the end dot plus its 2px ring
  const usable = Math.max(0, width - inset * 2);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = inset + (values.length === 1 ? usable / 2 : (usable * index) / (values.length - 1));
    const y = height - inset - ((value - min) / span) * (height - inset * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = last ? `${line} L${last[0].toFixed(1)},${height} L${inset},${height} Z` : "";

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {width > 0 && points.length > 1 ? (
        <svg width={width} height={height} role="img" aria-label={caption} style={{ display: "block" }}>
          <path d={area} fill={color} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {last ? (
            <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
    </div>
  );
}

/* ------------------------------ scale helpers ----------------------------- */

/** Round an axis up to clean numbers, so ticks read 0 / 2,000 / 4,000. */
function niceScale(max: number, divisions = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 10000, ticks: [0, 10000] };
  const rough = max / divisions;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value));
  return { top, ticks };
}

/* ------------------------------ flow columns ------------------------------ */

const PLOT_HEIGHT = 120;
const AXIS_HEIGHT = 24;

/**
 * Money in against money out, month by month. Two series, so a legend is
 * always present; per-bar values live in the hover tooltip and the ledger
 * rather than being stamped on every mark.
 */
export function FlowColumns({ data }: { data: MonthFlow[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const labelId = useId();

  const peak = Math.max(...data.map((f) => Math.max(f.inCents, f.outCents)), 0);
  const { top, ticks } = niceScale(peak);

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Legend items={[{ color: COLOR.in, label: "Money in" }, { color: COLOR.out, label: "Money out" }]} />
      </div>

      <div
        className="plot"
        style={{ height: PLOT_HEIGHT + AXIS_HEIGHT, ["--axis-h" as string]: `${AXIS_HEIGHT}px` }}
      >
        <div className="plot__grid">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="plot__gridline"
              style={{ bottom: `${(tick / top) * PLOT_HEIGHT}px` }}
            >
              <span className="plot__tick num">{tick === 0 ? "0" : formatCompact(tick).replace("$", "")}</span>
              <span className={`plot__rule${tick === 0 ? " plot__rule--base" : ""}`} />
            </div>
          ))}
        </div>

        <div className="plot__bands">
          {data.map((flow, index) => (
            <button
              key={flow.month}
              type="button"
              className="band"
              aria-describedby={hovered === index ? labelId : undefined}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered((current) => (current === index ? null : current))}
            >
              <span className="band__hl" style={{ height: PLOT_HEIGHT + 6 }} />

              {hovered === index ? (
                <FlowTooltip id={labelId} flow={flow} align={index === 0 ? "start" : index >= data.length - 2 ? "end" : "center"} />
              ) : null}

              <span className="band__bars" style={{ height: PLOT_HEIGHT }}>
                <span
                  className="band__bar"
                  style={{ height: (flow.inCents / top) * PLOT_HEIGHT, background: COLOR.in }}
                />
                <span
                  className="band__bar"
                  style={{ height: (flow.outCents / top) * PLOT_HEIGHT, background: COLOR.out }}
                />
              </span>
              <span className="band__label">{formatMonth(flow.month, true).slice(0, 3)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function FlowTooltip({
  id, flow, align,
}: { id: string; flow: MonthFlow; align: "start" | "center" | "end" }) {
  const position =
    align === "start"
      ? { left: 0 }
      : align === "end"
        ? { right: 0 }
        : { left: "50%", transform: "translateX(-50%)" };

  return (
    <div className="tooltip" id={id} role="tooltip" style={{ bottom: PLOT_HEIGHT + 10, ...position }}>
      <div className="tooltip__title">{formatMonth(flow.month)}</div>
      <div className="tooltip__row">
        <span className="swatch" style={{ background: COLOR.in }} />
        In<span className="num">{formatCents(flow.inCents)}</span>
      </div>
      <div className="tooltip__row">
        <span className="swatch" style={{ background: COLOR.out }} />
        Out<span className="num">{formatCents(flow.outCents)}</span>
      </div>
      <div className="tooltip__row tooltip__row--total">
        Left over
        <span className="num" style={{ color: flow.netCents >= 0 ? "var(--up)" : "var(--down)" }}>
          {formatCents(flow.netCents, { signed: flow.netCents >= 0 })}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------- magnitude bars ----------------------------- */

/**
 * Comparing magnitude across nominal categories, so every bar takes the same
 * hue: colouring them by value would spend the identity channel re-encoding
 * what bar length already shows.
 */
export function MagnitudeBars({
  rows, color = COLOR.out,
}: { rows: Array<{ label: string; cents: number }>; color?: string }) {
  const peak = Math.max(...rows.map((r) => r.cents), 1);
  return (
    <div className="magnitude">
      {rows.map((row) => (
        <div className="magnitude__row" key={row.label}>
          <div className="magnitude__head">
            <span>{row.label}</span>
            <span className="magnitude__value num">{formatCents(row.cents)}</span>
          </div>
          <span className="meter meter--thin" style={{ background: track(color) }}>
            <span
              className="meter__fill"
              style={{ width: `${(row.cents / peak) * 100}%`, background: color }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- composition bar ----------------------------- */

export interface Segment {
  label: string;
  cents: number;
  color: string;
}

/**
 * Part-to-whole. A 2px gap in the surface colour separates touching segments;
 * no stroke is drawn round a mark. Interior segments carry no inline label —
 * the legend below holds the names and the figures.
 */
export function CompositionBar({
  segments, totalCents, scaleTotalCents,
}: { segments: Segment[]; totalCents: number; scaleTotalCents?: number }) {
  const scale = scaleTotalCents ?? totalCents;
  const remainder = Math.max(0, scale - totalCents);
  return (
    <div className="composition">
      {segments
        .filter((segment) => segment.cents > 0)
        .map((segment) => (
          <span
            key={segment.label}
            className="composition__seg"
            style={{ flexGrow: segment.cents, background: segment.color }}
            title={`${segment.label}: ${formatCents(segment.cents)}`}
          />
        ))}
      {remainder > 0 ? <span style={{ flexGrow: remainder }} /> : null}
    </div>
  );
}

export function CompositionLegend({
  segments, totalCents,
}: { segments: Segment[]; totalCents: number }) {
  return (
    <div className="composition__legend">
      {segments
        .filter((segment) => segment.cents > 0)
        .map((segment) => (
          <div className="stack stack--gap-4" key={segment.label}>
            <span className="legend__item">
              <span className="swatch" style={{ background: segment.color }} />
              {segment.label}
              {totalCents > 0 ? ` · ${Math.round((segment.cents / totalCents) * 100)}%` : ""}
            </span>
            <span className="num small" style={{ paddingLeft: 15, fontWeight: 500 }}>
              {formatCents(segment.cents)}
            </span>
          </div>
        ))}
    </div>
  );
}

/* --------------------------- target history bars -------------------------- */

/** Six small columns of progress, one hue, with an optional cap rule. */
export function HistoryBars({
  values, labels, color, capCents,
}: { values: number[]; labels: string[]; color: string; capCents?: number }) {
  const height = 46;
  const peak = Math.max(...values, capCents ?? 0, 1);
  return (
    <div style={{ position: "relative", display: "flex", gap: 4 }}>
      {capCents !== undefined ? (
        <>
          <span
            style={{
              position: "absolute", left: 0, right: 0,
              bottom: (capCents / peak) * height + 17,
              height: 1, background: "var(--baseline)",
            }}
          />
          <span
            style={{
              position: "absolute", right: 0,
              bottom: (capCents / peak) * height + 20,
              fontSize: 9.5, color: "var(--ink-3)",
            }}
          >
            cap
          </span>
        </>
      ) : null}
      {values.map((value, index) => (
        <div key={labels[index] ?? index} className="stack stack--gap-4" style={{ flex: 1, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "flex-end", height }}>
            <span
              style={{
                width: 24, maxWidth: 24,
                // A zero month renders nothing; a 3px stub would read as a small spend.
                height: value === 0 ? 0 : Math.max(3, (value / peak) * height),
                borderRadius: "4px 4px 0 0",
                background: color,
              }}
            />
          </span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}
