/**
 * Everything a recurring rule says should have happened by now.
 *
 * Rules that record themselves have already been posted by the time this
 * renders; what is left is the ones that want confirming, plus any whose amount
 * varies and is still blank. Nothing here is recorded without being pressed.
 */

import { useState } from "react";
import type { DueOccurrence } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { formatDate } from "@shared/dates.js";
import { api, ApiError } from "../lib/api.js";
import { COLOR, wash } from "../lib/present.js";
import { Icon } from "../lib/icons.js";
import { Banner, Button, Card, CardHead, IconButton } from "./ui.js";

export function DueTray({
  due, onChanged,
}: { due: DueOccurrence[]; onChanged: () => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (due.length === 0) return null;

  const keyOf = (occurrence: DueOccurrence) =>
    `${occurrence.schedule.id}:${occurrence.occurredOn}`;

  /** An occurrence is ready when it has a fixed amount, or you have typed one. */
  function amountFor(occurrence: DueOccurrence): number | null {
    if (occurrence.amountCents !== null) return occurrence.amountCents;
    const typed = amounts[keyOf(occurrence)];
    if (!typed) return null;
    const parsed = parseMoney(typed);
    return parsed.ok && parsed.cents > 0 ? parsed.cents : null;
  }

  const ready = due.filter((occurrence) => amountFor(occurrence) !== null);

  /*
   * Skipping moves a rule forward one occurrence, so it only makes sense on the
   * oldest one it still owes. Offering it on a later row would imply skipping
   * just that row while actually skipping the earliest.
   */
  const oldestPerSchedule = new Map<string, string>();
  for (const occurrence of due) {
    const seen = oldestPerSchedule.get(occurrence.schedule.id);
    if (!seen || occurrence.occurredOn < seen) {
      oldestPerSchedule.set(occurrence.schedule.id, occurrence.occurredOn);
    }
  }

  async function record(list: DueOccurrence[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.postDue(
        list.map((occurrence) => ({
          scheduleId: occurrence.schedule.id,
          occurredOn: occurrence.occurredOn,
          amountCents: amountFor(occurrence) ?? undefined,
        })),
      );
      if (result.skipped.length > 0) {
        setError(result.skipped[0]?.reason ?? "Some of those couldn't be recorded.");
      }
      setAmounts({});
      onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't record those.");
    } finally {
      setBusy(false);
    }
  }

  async function skip(occurrence: DueOccurrence) {
    setBusy(true);
    try {
      await api.skipSchedule(occurrence.schedule.id);
      onChanged();
    } catch {
      setError("Couldn't skip that one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title={`${due.length} ${due.length === 1 ? "movement is" : "movements are"} due`}
        sub="Recorded only when you say so. Anything your bank does by itself is already in."
        action={
          ready.length > 0 ? (
            <Button variant="primary" icon="check" disabled={busy} onClick={() => void record(ready)}>
              {busy ? "Recording…" : `Record ${ready.length}`}
            </Button>
          ) : undefined
        }
      />

      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="stack">
        {due.map((occurrence) => {
          const key = keyOf(occurrence);
          const { schedule } = occurrence;
          const varies = occurrence.amountCents === null;
          return (
            <div className="due__row" key={key}>
              <span
                className="holding__glyph"
                style={{ background: wash(COLOR[schedule.direction]), color: COLOR[schedule.direction] }}
              >
                <Icon name="repeat" size={16} />
              </span>

              <span className="stack stack--gap-2 grow">
                <span className="holding__name">{schedule.name}</span>
                <span className="holding__meta">
                  {formatDate(occurrence.occurredOn)}
                  {schedule.reason ? ` · ${schedule.reason}` : ""}
                </span>
              </span>

              {varies ? (
                <span className="due__amount">
                  <label className="visually-hidden" htmlFor={`due-${key}`}>
                    Amount for {schedule.name} on {formatDate(occurrence.occurredOn)}
                  </label>
                  <input
                    id={`due-${key}`}
                    className="num"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amounts[key] ?? ""}
                    onChange={(event) =>
                      setAmounts((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </span>
              ) : (
                <span className="num holding__value due__amount" style={{ textAlign: "right" }}>
                  {formatCents(occurrence.amountCents!)}
                </span>
              )}

              <IconButton
                name="check"
                label={`Record ${schedule.name}`}
                bare
                disabled={busy || amountFor(occurrence) === null}
                onClick={() => void record([occurrence])}
              />
              {oldestPerSchedule.get(schedule.id) === occurrence.occurredOn ? (
                <IconButton
                  name="close"
                  label={`Skip ${schedule.name} for ${formatDate(occurrence.occurredOn)}`}
                  bare
                  disabled={busy}
                  onClick={() => void skip(occurrence)}
                />
              ) : (
                <span style={{ width: 34, flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
