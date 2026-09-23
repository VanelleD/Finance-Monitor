/**
 * A recurring movement of money: a paycheque, a standing transfer, a bill.
 *
 * Two choices here carry weight. An amount can be marked as varying, in which
 * case the occurrence still comes due but waits for a figure. And a rule can be
 * set to record itself, which is right for a transfer the bank performs and
 * wrong for anything you decide each time.
 */

import { useState } from "react";
import type { Cadence, Direction, Schedule } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { api, ApiError, type Snapshot } from "../lib/api.js";
import { CADENCE_LABELS, COLOR, monthlyHint } from "../lib/present.js";
import { Banner, Button, Modal, Segmented, SelectField, TextField } from "./ui.js";

const DIRECTIONS: Array<{ value: Direction; label: string; dot: string }> = [
  { value: "in", label: "Money in", dot: COLOR.in },
  { value: "out", label: "Money out", dot: COLOR.out },
  { value: "transfer", label: "Transfer", dot: COLOR.transfer },
];

export function ScheduleDialog({
  snapshot, schedule, onClose, onSaved,
}: { snapshot: Snapshot; schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  const editing = schedule !== undefined;

  const [name, setName] = useState(schedule?.name ?? "");
  const [direction, setDirection] = useState<Direction>(schedule?.direction ?? "out");
  const [varies, setVaries] = useState(schedule ? schedule.amountCents === null : false);
  const [amount, setAmount] = useState(
    schedule?.amountCents != null ? formatCents(schedule.amountCents, { bare: true }) : "",
  );
  const [cadence, setCadence] = useState<Cadence>(schedule?.cadence ?? "monthly");
  const [anchorDate, setAnchorDate] = useState(schedule?.anchorDate ?? snapshot.today);
  const [autoPost, setAutoPost] = useState(schedule?.autoPost ?? false);
  const [accountId, setAccountId] = useState(schedule?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState(schedule?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(schedule?.categoryId ?? "");
  const [sourceId, setSourceId] = useState(schedule?.sourceId ?? "");
  const [targetId, setTargetId] = useState(schedule?.targetId ?? "");
  const [reason, setReason] = useState(schedule?.reason ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accounts = snapshot.accounts.filter((a) => !a.archived);
  const categories = snapshot.categories.filter(
    (c) => !c.archived && c.direction === (direction === "in" ? "in" : "out"),
  );
  const parsedAmount = varies ? null : parseMoney(amount);

  // Nothing can post by itself if nobody knows what it would post.
  const canAutoPost = !varies;

  async function save() {
    if (!name.trim()) return setErrors({ name: "Give the rule a name." });
    let amountCents: number | null = null;
    if (!varies) {
      const parsed = parseMoney(amount);
      if (!parsed.ok) return setErrors({ amountCents: parsed.error });
      if (parsed.cents <= 0) return setErrors({ amountCents: "Enter an amount above zero." });
      amountCents = parsed.cents;
    }
    if (direction === "transfer" && !toAccountId) {
      return setErrors({ toAccountId: "A transfer needs a destination account." });
    }
    if (direction === "transfer" && toAccountId === accountId) {
      return setErrors({ toAccountId: "Pick two different accounts." });
    }

    const payload = {
      name: name.trim(),
      direction,
      amountCents,
      cadence,
      anchorDate,
      autoPost: canAutoPost && autoPost,
      payee: name.trim(),
      reason: reason.trim(),
      accountId: accountId || null,
      toAccountId: direction === "transfer" ? toAccountId || null : null,
      categoryId: direction === "transfer" ? null : categoryId || null,
      sourceId: direction === "in" ? sourceId || null : null,
      targetId: targetId || null,
      liabilityId: null,
      archived: false,
    };

    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      if (editing && schedule) await api.updateSchedule(schedule.id, payload);
      else await api.createSchedule(payload);
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? null : error.message);
      } else setFailure("Couldn't save that rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit recurring rule" : "New recurring rule"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save rule"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <TextField
          label="What is it"
          id="schedule-name"
          icon="repeat"
          autoComplete="off"
          placeholder="Fidelity weekly transfer"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />

        <Segmented
          label="Which way does the money go?"
          options={DIRECTIONS}
          value={direction}
          onChange={(next) => {
            setDirection(next);
            setCategoryId("");
            setErrors({});
          }}
          fill
        />

        <div className="field__row">
          <SelectField
            label="How often"
            id="schedule-cadence"
            icon="repeat"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
          >
            {(Object.entries(CADENCE_LABELS) as Array<[Cadence, string]>).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectField>

          <TextField
            label="Starting from"
            id="schedule-anchor"
            type="date"
            icon="calendar"
            value={anchorDate}
            error={errors.anchorDate}
            hint="Every later occurrence is counted from this date."
            onChange={(event) => setAnchorDate(event.target.value)}
          />
        </div>

        <div className="stack stack--gap-8">
          <div className="checkrow">
            <span style={{ color: "var(--ink-3)", display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M4 12h16M12 4v16" />
              </svg>
            </span>
            <label htmlFor="schedule-varies">The amount is different every time</label>
            <input
              id="schedule-varies"
              type="checkbox"
              checked={varies}
              onChange={(event) => {
                setVaries(event.target.checked);
                if (event.target.checked) setAutoPost(false);
              }}
            />
          </div>

          {varies ? (
            <Banner kind="info">
              It will still come due on schedule — you type the figure when you record it.
            </Banner>
          ) : (
            <TextField
              label="Amount"
              id="schedule-amount"
              className="num"
              icon="wallet"
              inputMode="decimal"
              autoComplete="off"
              placeholder="50.00"
              value={amount}
              error={errors.amountCents}
              hint={
                parsedAmount && parsedAmount.ok && parsedAmount.cents > 0
                  ? monthlyHint(parsedAmount.cents, cadence)
                  : undefined
              }
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </div>

        <div className="field__row">
          <SelectField
            label={direction === "in" ? "Lands in" : direction === "out" ? "Paid from" : "From account"}
            id="schedule-account"
            icon="wallet"
            value={accountId}
            error={errors.accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">— not set —</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </SelectField>

          {direction === "transfer" ? (
            <SelectField
              label="To account"
              id="schedule-to"
              icon="wallet"
              value={toAccountId}
              error={errors.toAccountId}
              onChange={(event) => setToAccountId(event.target.value)}
            >
              <option value="">— choose —</option>
              {accounts.filter((a) => a.id !== accountId).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </SelectField>
          ) : (
            <SelectField
              label="Category"
              id="schedule-category"
              icon="tag"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">— uncategorised —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="field__row">
          {direction === "in" ? (
            <SelectField
              label="Money source"
              id="schedule-source"
              icon="bank"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">— not set —</option>
              {snapshot.sources.filter((s) => !s.archived).map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </SelectField>
          ) : (
            <SelectField
              label="Counts toward"
              id="schedule-target"
              icon="target"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Not tracked</option>
              {snapshot.targets.filter((t) => !t.archived).map((target) => (
                <option key={target.id} value={target.id}>{target.name}</option>
              ))}
            </SelectField>
          )}

          <TextField
            label="Note"
            id="schedule-reason"
            icon="note"
            autoComplete="off"
            placeholder="Optional"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="checkrow" style={{ opacity: canAutoPost ? 1 : 0.55 }}>
          <span style={{ color: "var(--ink-3)", display: "flex" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8.5h11.5a4 4 0 0 1 0 8H9M6.5 5.5l-3 3 3 3M11.5 13.5l-3 3 3 3" />
            </svg>
          </span>
          <label htmlFor="schedule-auto">
            Record this by itself
            <span className="tiny muted" style={{ display: "block" }}>
              {canAutoPost
                ? "For transfers your bank makes on its own, which always happen."
                : "Not available while the amount varies."}
            </span>
          </label>
          <input
            id="schedule-auto"
            type="checkbox"
            checked={canAutoPost && autoPost}
            disabled={!canAutoPost}
            onChange={(event) => setAutoPost(event.target.checked)}
          />
        </div>
        {errors.autoPost ? <span className="field__error">{errors.autoPost}</span> : null}
      </div>
    </Modal>
  );
}
