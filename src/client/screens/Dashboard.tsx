import type { DueOccurrence, Entry } from "@shared/types.js";
import {
  categoryTotals, flowForMonth, flowSeries, netWorthFrom, netWorthTrend, ownedCents,
  targetProgress, totalLiabilitiesCents, withOther,
} from "@shared/derive.js";
import { formatCents } from "@shared/money.js";
import { formatDate, formatMonth, monthsEnding } from "@shared/dates.js";
import type { Snapshot } from "../lib/api.js";
import { COLOR, directionColor, percent, targetKind } from "../lib/present.js";
import { Card, CardHead, Delta, Empty, Meter, StatusChip, Swatch } from "../components/ui.js";
import { FlowColumns, MagnitudeBars, Sparkline } from "../components/charts.js";
import { DueTray } from "../components/DueTray.js";

export function Dashboard({
  snapshot, month, due, onAdd, onGoTo, onEditEntry, onChanged,
}: {
  snapshot: Snapshot;
  month: string;
  due: DueOccurrence[];
  onAdd: () => void;
  onGoTo: (route: "ledger" | "accounts" | "worth" | "targets") => void;
  onEditEntry: (entry: Entry) => void;
  onChanged: () => void;
}) {
  const { entries, assets, liabilities, targets, categories, accounts } = snapshot;

  const worth = netWorthFrom({ accounts, balances: snapshot.balances, assets, liabilities });
  const owned = ownedCents(accounts, snapshot.balances, assets);
  const months = monthsEnding(month, 6);
  const flows = flowSeries(entries, months);
  const flow = flowForMonth(entries, month);
  const trend = netWorthTrend(worth, entries, months);

  const monthEntries = entries.filter((e) => e.occurredOn.startsWith(month));
  const recent = monthEntries.slice(0, 6);
  const outCount = monthEntries.filter((e) => e.direction === "out").length;
  const inCount = monthEntries.filter((e) => e.direction === "in").length;

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Uncategorised";
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "";

  const spend = withOther(categoryTotals(entries, month, "out"), 6);
  const spendRows = [
    ...spend.top.map((row) => ({ label: categoryName(row.categoryId), cents: row.cents })),
    ...(spend.otherCents > 0 ? [{ label: "Everything else", cents: spend.otherCents }] : []),
  ];

  const liveTargets = targets.filter((t) => !t.archived).slice(0, 3);
  const hasData =
    entries.length > 0 || assets.length > 0 || liabilities.length > 0 || accounts.length > 0;

  if (!hasData) {
    return (
      <Card>
        <Empty title="Nothing here yet">
          Add your first entry, or record what you own and owe on the Net worth screen. Everything on
          this dashboard is worked out from those two things.
        </Empty>
      </Card>
    );
  }

  const worthDelta = trend.length >= 2 ? worth - (trend[trend.length - 2] ?? worth) : 0;

  return (
    <>
      <DueTray due={due} onChanged={onChanged} />

      <div className="grid-hero">
        <Card>
          <div className="stack" style={{ height: "100%" }}>
            <div className="row">
              <h2 className="eyebrow">Net worth</h2>
              <span className="tiny muted" style={{ marginLeft: "auto" }}>
                as of {formatDate(snapshot.today)}
              </span>
            </div>

            <p className="hero-figure figure">{formatCents(worth)}</p>

            <div className="row" style={{ marginTop: 6 }}>
              {worthDelta !== 0 ? (
                <Delta good={worthDelta >= 0}>
                  {formatCents(worthDelta, { signed: worthDelta >= 0 })}
                </Delta>
              ) : (
                <span className="tiny muted">No change since last month</span>
              )}
              <span className="tiny muted">
                {owned > 0
                  ? `${formatCents(owned, { whole: true })} owned, ${formatCents(totalLiabilitiesCents(liabilities), { whole: true })} owed`
                  : "Add an account to make this exact"}
              </span>
            </div>

            <div style={{ marginTop: "auto", paddingTop: 14 }}>
              <Sparkline
                values={trend}
                caption={`Estimated net worth from ${formatMonth(months[0]!)} to ${formatMonth(month)}, ${formatCents(trend[0] ?? 0)} to ${formatCents(worth)}`}
              />
              <div className="row tiny muted" style={{ marginTop: 4 }}>
                <span>{formatMonth(months[0]!, true)}</span>
                <span style={{ marginLeft: "auto" }}>{formatMonth(month, true)}</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Traced back through your monthly flow, so it shows money saved and spent — not
                investments rising or a car depreciating.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="statlist">
            <div className="statlist__row">
              <Swatch color={COLOR.in} />
              <span className="stack stack--gap-2">
                <span className="statlist__label">Money in</span>
                <span className="statlist__meta">
                  {inCount} {inCount === 1 ? "deposit" : "deposits"} &middot; {formatMonth(month)}
                </span>
              </span>
              <span className="statlist__value num">{formatCents(flow.inCents)}</span>
            </div>

            <div className="statlist__row">
              <Swatch color={COLOR.out} />
              <span className="stack stack--gap-2">
                <span className="statlist__label">Money out</span>
                <span className="statlist__meta">
                  {outCount} {outCount === 1 ? "payment" : "payments"} &middot; {formatMonth(month)}
                </span>
              </span>
              <span className="statlist__value num">{formatCents(flow.outCents)}</span>
            </div>

            <div className="statlist__row">
              <span className="stack stack--gap-2">
                <span className="statlist__label">Left over</span>
                <span className="statlist__meta">
                  {flow.savingsRate === null
                    ? "No income recorded this month"
                    : `You kept ${percent(flow.savingsRate)} of what came in`}
                </span>
              </span>
              <span
                className="statlist__value num"
                style={{ color: flow.netCents >= 0 ? "var(--up)" : "var(--down)" }}
              >
                {formatCents(flow.netCents, { signed: flow.netCents >= 0 })}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid-split">
        <Card>
          <CardHead
            title="Money in vs money out"
            sub="Last 6 months &middot; hover or tab a month for detail"
            action={
              <button
                type="button"
                className="icon-btn"
                aria-label="Open as a table"
                onClick={() => onGoTo("ledger")}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.2" />
                  <path d="M3.2 9.6h17.6M9.2 9.6v10M3.2 14.6h17.6" />
                </svg>
              </button>
            }
          />
          <FlowColumns data={flows} />
        </Card>

        <Card>
          <CardHead
            title="Where it went"
            sub={`${formatMonth(month)} · ${formatCents(flow.outCents)} across ${outCount} ${outCount === 1 ? "payment" : "payments"}`}
          />
          {spendRows.length > 0 ? (
            <MagnitudeBars rows={spendRows} />
          ) : (
            <Empty title="Nothing spent this month">Add an entry to see it broken down here.</Empty>
          )}
        </Card>
      </div>

      <div className="grid-split">
        <Card>
          <CardHead
            title="Recent activity"
            sub="Newest first"
            action={
              monthEntries.length > recent.length ? (
                <button type="button" className="btn btn--ghost" onClick={() => onGoTo("ledger")}>
                  See all {monthEntries.length}
                </button>
              ) : undefined
            }
          />
          {recent.length > 0 ? (
            <div className="stack">
              {recent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="holding"
                  onClick={() => onEditEntry(item)}
                  style={{ gap: 11, padding: "8px 6px" }}
                >
                  <span className="num tiny muted" style={{ width: 46, flexShrink: 0, textAlign: "left" }}>
                    {formatDate(item.occurredOn, true)}
                  </span>
                  <Swatch color={directionColor(item.direction)} />
                  <span className="stack stack--gap-2 grow">
                    <span className="holding__name truncate" style={{ maxWidth: "100%" }}>
                      {item.payee || categoryName(item.categoryId)}
                    </span>
                    <span className="holding__meta truncate" style={{ maxWidth: "100%" }}>
                      {[item.reason, accountName(item.accountId)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span
                    className="num holding__value"
                    style={{
                      marginLeft: "auto",
                      color:
                        item.direction === "in"
                          ? "var(--up)"
                          : item.direction === "transfer"
                            ? "var(--ink-2)"
                            : "var(--ink)",
                    }}
                  >
                    {formatCents(item.amountCents, { signed: item.direction === "in" })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty title={`Nothing recorded in ${formatMonth(month)}`}>
              <button type="button" className="btn btn--outline" onClick={onAdd}>
                Add an entry
              </button>
            </Empty>
          )}
        </Card>

        <Card>
          <CardHead
            title="Targets"
            sub={`${liveTargets.length} active`}
            action={
              <button type="button" className="btn btn--ghost" onClick={() => onGoTo("targets")}>
                Manage
              </button>
            }
          />
          {liveTargets.length > 0 ? (
            <div className="stack stack--gap-16">
              {liveTargets.map((target) => {
                const progress = targetProgress(target, {
                  ...snapshot,
                  balances: snapshot.balances,
                  today: snapshot.today,
                });
                const { color } = targetKind(target.kind);
                return (
                  <div className="stack stack--gap-8" key={target.id}>
                    <div className="row">
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{target.name}</span>
                      <span style={{ marginLeft: "auto" }}>
                        <StatusChip status={progress.status} />
                      </span>
                    </div>
                    <Meter
                      fraction={progress.fraction}
                      color={color}
                      label={`${target.name}: ${percent(progress.fraction)}`}
                    />
                    <span className="num tiny muted">
                      {formatCents(progress.currentCents, { whole: true })} of{" "}
                      {formatCents(progress.goalCents, { whole: true })} &middot;{" "}
                      {percent(progress.fraction)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="No targets yet">
              <button type="button" className="btn btn--outline" onClick={() => onGoTo("targets")}>
                Set your first target
              </button>
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
