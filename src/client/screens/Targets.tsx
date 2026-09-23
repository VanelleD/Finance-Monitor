import { useState } from "react";
import type { Target } from "@shared/types.js";
import { flowForMonth, targetProgress } from "@shared/derive.js";
import { formatCents } from "@shared/money.js";
import { daysLeftInMonth, formatDate, formatMonth, monthOf, monthsEnding } from "@shared/dates.js";
import { api, type Snapshot } from "../lib/api.js";
import { percent, targetKind, wash } from "../lib/present.js";
import { Icon } from "../lib/icons.js";
import { Button, Card, Empty, IconButton, Meter, StatusChip } from "../components/ui.js";
import { HistoryBars } from "../components/charts.js";
import { TargetDialog } from "../components/TargetDialog.js";

export function Targets({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: () => void }) {
  const [editing, setEditing] = useState<Target | "new" | null>(null);
  const targets = snapshot.targets.filter((t) => !t.archived);

  const progresses = targets.map((target) => ({
    target,
    progress: targetProgress(target, { ...snapshot, balances: snapshot.balances, today: snapshot.today }),
  }));

  const needingAttention = progresses.filter(
    (row) => row.progress.status === "attention" || row.progress.status === "over",
  ).length;
  const combined =
    progresses.length > 0
      ? progresses.reduce((total, row) => total + row.progress.fraction, 0) / progresses.length
      : null;
  const stillToSave = progresses
    .filter((row) => row.target.kind === "save_to" || row.target.kind === "net_worth")
    .reduce((total, row) => total + row.progress.remainingCents, 0);
  const nearestDeadline = targets
    .map((t) => t.deadline)
    .filter((d): d is string => d !== null)
    .sort()[0];

  async function removeTarget(target: Target) {
    if (!window.confirm(`Remove "${target.name}"? This can't be undone.`)) return;
    await api.deleteTarget(target.id);
    onChanged();
  }

  if (targets.length === 0) {
    return (
      <>
        <Card>
          <Empty
            title="No targets yet"
            action={
              <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
                Set your first target
              </Button>
            }
          >
            A target can be money to save, a debt to clear, a monthly cap to stay under, or a net worth
            to reach. Each one is measured from the entries you already record.
          </Empty>
        </Card>
        {editing ? (
          <TargetDialog
            snapshot={snapshot}
            onClose={() => setEditing(null)}
            onSaved={onChanged}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <Card flush>
        <div className="statstrip">
          <div className="statstrip__cell">
            <span className="statstrip__label">Active targets</span>
            <span className="statstrip__value num">{targets.length}</span>
            <span className="statstrip__meta">
              {needingAttention === 0
                ? "all on track"
                : `${needingAttention} need${needingAttention === 1 ? "s" : ""} attention`}
            </span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">Combined progress</span>
            <span className="statstrip__value num">{percent(combined)}</span>
            <span className="statstrip__meta">average across every target</span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">Still to save</span>
            <span className="statstrip__value num">{formatCents(stillToSave, { whole: true })}</span>
            <span className="statstrip__meta">across savings and net-worth goals</span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">Nearest deadline</span>
            <span className="statstrip__value num">
              {nearestDeadline ? formatMonth(monthOf(nearestDeadline), true) : "—"}
            </span>
            <span className="statstrip__meta">
              {nearestDeadline ? formatDate(nearestDeadline) : "no deadlines set"}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid-wide">
        {progresses.map(({ target, progress }) => {
          const kind = targetKind(target.kind);
          const months = monthsEnding(monthOf(snapshot.today), 6);

          // Each card's small chart answers the question that target actually asks.
          const history =
            target.kind === "spend_under"
              ? months.map((month) =>
                  snapshot.entries
                    .filter(
                      (e) =>
                        e.direction === "out" &&
                        e.categoryId === target.categoryId &&
                        monthOf(e.occurredOn) === month,
                    )
                    .reduce((total, e) => total + e.amountCents, 0),
                )
              : target.kind === "net_worth"
                ? months.map((month) => Math.max(0, flowForMonth(snapshot.entries, month).netCents))
                : months.map((month) =>
                    snapshot.entries
                      .filter((e) => e.targetId === target.id && monthOf(e.occurredOn) === month)
                      .reduce((total, e) => total + e.amountCents, 0),
                  );

          const historyLabels = months.map((month) => formatMonth(month, true).slice(0, 3));
          const hasHistory = history.some((value) => value > 0);

          return (
            <Card key={target.id}>
              <div className="target-card">
                <div className="target-card__head">
                  <span
                    className="target-card__glyph"
                    style={{ background: wash(kind.color), color: kind.color }}
                  >
                    <Icon name={kind.icon} size={18} />
                  </span>
                  <span className="stack stack--gap-2 grow">
                    <span className="target-card__name">{target.name}</span>
                    <span className="target-card__kind">
                      {kind.label}
                      {target.deadline ? ` · by ${formatMonth(monthOf(target.deadline), true)}` : ""}
                      {target.kind === "spend_under" ? " · resets each month" : ""}
                    </span>
                  </span>
                  <StatusChip status={progress.status} />
                  <IconButton name="pencil" label={`Edit ${target.name}`} bare onClick={() => setEditing(target)} />
                  <IconButton name="trash" label={`Remove ${target.name}`} bare onClick={() => void removeTarget(target)} />
                </div>

                <div>
                  <div className="target-card__figures">
                    <span className="target-card__current num figure">
                      {formatCents(progress.currentCents, { whole: true })}
                    </span>
                    <span className="target-card__of">
                      {target.kind === "spend_under"
                        ? `of ${formatCents(progress.goalCents, { whole: true })} this month`
                        : target.kind === "pay_off"
                          ? `of ${formatCents(progress.goalCents, { whole: true })} cleared`
                          : `of ${formatCents(progress.goalCents, { whole: true })}`}
                    </span>
                    <span className="target-card__pct num">{percent(progress.fraction)}</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Meter
                      fraction={progress.fraction}
                      color={kind.color}
                      label={`${target.name}: ${percent(progress.fraction)}`}
                    />
                  </div>
                </div>

                <div className="target-card__pace">
                  {target.kind === "spend_under" ? (
                    <>
                      <div>
                        <div className="target-card__pace-label">Left this month</div>
                        <div className="target-card__pace-value num">
                          {formatCents(progress.remainingCents)}
                        </div>
                      </div>
                      <div>
                        <div className="target-card__pace-label">Days remaining</div>
                        <div className="target-card__pace-value num">
                          {daysLeftInMonth(snapshot.today)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="target-card__pace-label">Needed each month</div>
                        <div className="target-card__pace-value num">
                          {progress.requiredPerMonthCents === null
                            ? "—"
                            : formatCents(progress.requiredPerMonthCents)}
                        </div>
                      </div>
                      <div>
                        <div className="target-card__pace-label">Your recent pace</div>
                        <div className="target-card__pace-value num">
                          {progress.pacePerMonthCents === null
                            ? "not enough history"
                            : formatCents(progress.pacePerMonthCents)}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {hasHistory ? (
                  <HistoryBars
                    values={history}
                    labels={historyLabels}
                    color={kind.color}
                    capCents={target.kind === "spend_under" ? target.amountCents : undefined}
                  />
                ) : null}

                <div className="target-card__foot">
                  <span>
                    {target.kind === "spend_under"
                      ? "Spend against the cap, last 6 months"
                      : hasHistory
                        ? "Progress, last 6 months"
                        : "Tag entries with this target to build up history"}
                  </span>
                  <span className="grow" />
                  {progress.monthsRemaining !== null ? (
                    <span>
                      {progress.monthsRemaining === 0
                        ? "deadline reached"
                        : `${progress.monthsRemaining} month${progress.monthsRemaining === 1 ? "" : "s"} left`}
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {editing ? (
        <TargetDialog
          snapshot={snapshot}
          target={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}
