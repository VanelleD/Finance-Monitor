/**
 * Add or edit one movement of money.
 *
 * Direction is the first choice because it changes everything after it: what
 * the account field means, which categories make sense, and whether a
 * destination account is required.
 */

import { useState } from "react";
import type { Direction, Entry } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { todayISO } from "@shared/dates.js";
import { api, ApiError } from "../lib/api.js";
import type { Snapshot } from "../lib/api.js";
import { COLOR, DIRECTION_LABELS, wash } from "../lib/present.js";
import { Banner, Button, Modal, Segmented, SelectField, TextField } from "./ui.js";

const DIRECTIONS: Array<{ value: Direction; label: string; dot: string }> = [
  { value: "in", label: "Money in", dot: COLOR.in },
  { value: "out", label: "Money out", dot: COLOR.out },
  { value: "transfer", label: "Transfer", dot: COLOR.transfer },
];

function accountLabel(direction: Direction): string {
  if (direction === "in") return "Deposited into";
  if (direction === "out") return "Paid from";
  return "From account";
}

export function EntryDialog({
  snapshot, entry, onClose, onSaved,
}: {
  snapshot: Snapshot;
  entry?: Entry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = entry !== undefined;

  const [direction, setDirection] = useState<Direction>(entry?.direction ?? "out");
  const [amount, setAmount] = useState(
    entry ? formatCents(entry.amountCents, { bare: true }) : "",
  );
  const [occurredOn, setOccurredOn] = useState(entry?.occurredOn ?? snapshot.today ?? todayISO());
  const [payee, setPayee] = useState(entry?.payee ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [accountId, setAccountId] = useState(entry?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState(entry?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [sourceId, setSourceId] = useState(entry?.sourceId ?? "");
  const [targetId, setTargetId] = useState(entry?.targetId ?? "");
  const [repeats, setRepeats] = useState(entry?.repeatRule === "monthly");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accounts = snapshot.accounts.filter((a) => !a.archived);
  const categories = snapshot.categories.filter(
    (c) => !c.archived && c.direction === (direction === "in" ? "in" : "out"),
  );
  const targets = snapshot.targets.filter((t) => !t.archived);
  const accent = COLOR[direction];
  const sign = direction === "in" ? "+" : direction === "transfer" ? "" : "−";

  function changeDirection(next: Direction) {
    setDirection(next);
    setCategoryId(""); // the old category belongs to the old direction
    setErrors({});
  }

  async function save(addAnother: boolean) {
    const parsed = parseMoney(amount);
    if (!parsed.ok) {
      setErrors({ amountCents: parsed.error });
      return;
    }
    if (parsed.cents <= 0) {
      setErrors({ amountCents: "Enter an amount above zero." });
      return;
    }
    if (direction === "transfer" && !toAccountId) {
      setErrors({ toAccountId: "A transfer needs a destination account." });
      return;
    }
    if (direction === "transfer" && toAccountId === accountId) {
      setErrors({ toAccountId: "Pick two different accounts." });
      return;
    }

    const payload = {
      direction,
      amountCents: parsed.cents,
      occurredOn,
      payee: payee.trim(),
      reason: reason.trim(),
      accountId: accountId || null,
      toAccountId: direction === "transfer" ? toAccountId || null : null,
      categoryId: direction === "transfer" ? null : categoryId || null,
      sourceId: direction === "in" ? sourceId || null : null,
      targetId: targetId || null,
      repeatRule: repeats ? ("monthly" as const) : null,
    };

    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      if (editing && entry) await api.updateEntry(entry.id, payload);
      else await api.createEntry(payload);

      if (addAnother) {
        setAmount("");
        setPayee("");
        setReason("");
        onSaved();
      } else {
        onSaved();
        onClose();
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? null : error.message);
      } else {
        setFailure("Couldn't save that entry.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit entry" : "Add entry"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          {!editing ? (
            <Button variant="outline" onClick={() => void save(true)} disabled={saving}>
              Save and add another
            </Button>
          ) : null}
          <Button variant="primary" icon="check" onClick={() => void save(false)} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : `Save ${DIRECTION_LABELS[direction].toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <Segmented
          label="What kind of entry is this?"
          options={DIRECTIONS}
          value={direction}
          onChange={changeDirection}
          fill
        />

        <div className="field">
          <label className="field__label" htmlFor="amount">Amount</label>
          <div
            className="amount-control"
            style={{ borderColor: errors.amountCents ? "var(--down)" : accent }}
          >
            <span className="amount-control__sign num" style={{ color: accent, width: 18 }}>{sign}</span>
            <span className="amount-control__symbol num">$</span>
            <input
              id="amount"
              className="num"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              aria-invalid={errors.amountCents ? true : undefined}
              onChange={(event) => setAmount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save(false);
              }}
            />
            <span className="amount-control__unit">USD</span>
          </div>
          {errors.amountCents ? <span className="field__error">{errors.amountCents}</span> : null}
        </div>

        <div className="field__row">
          <TextField
            label="Date"
            id="occurredOn"
            type="date"
            icon="calendar"
            value={occurredOn}
            error={errors.occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
          <SelectField
            label={accountLabel(direction)}
            id="accountId"
            icon="wallet"
            value={accountId}
            error={errors.accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">{accounts.length ? "— not set —" : "No accounts yet"}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </SelectField>
        </div>

        <div className="field__row">
          {direction === "transfer" ? (
            <SelectField
              label="To account"
              id="toAccountId"
              icon="wallet"
              value={toAccountId}
              error={errors.toAccountId}
              onChange={(event) => setToAccountId(event.target.value)}
            >
              <option value="">— choose —</option>
              {accounts
                .filter((account) => account.id !== accountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
            </SelectField>
          ) : (
            <SelectField
              label="Category"
              id="categoryId"
              icon="tag"
              value={categoryId}
              error={errors.categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">— uncategorised —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </SelectField>
          )}

          <SelectField
            label="Counts toward"
            id="targetId"
            icon="target"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Not tracked</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>{target.name}</option>
            ))}
          </SelectField>
        </div>

        <div className="field__row">
          <TextField
            label={direction === "in" ? "Who paid you" : direction === "out" ? "Who you paid" : "Description"}
            id="payee"
            icon="note"
            autoComplete="off"
            placeholder={direction === "in" ? "Northwind Labs" : "Whole Foods Market"}
            value={payee}
            error={errors.payee}
            onChange={(event) => setPayee(event.target.value)}
          />
          {direction === "in" ? (
            <SelectField
              label="Money source"
              id="sourceId"
              icon="bank"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">— not set —</option>
              {snapshot.sources
                .filter((source) => !source.archived)
                .map((source) => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
            </SelectField>
          ) : (
            <div />
          )}
        </div>

        <TextField
          label="Reason / note"
          id="reason"
          icon="note"
          autoComplete="off"
          placeholder="Why this happened — the thing you'll want to remember later"
          value={reason}
          error={errors.reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <div className="checkrow" style={{ background: repeats ? wash(accent) : undefined }}>
          <span style={{ color: "var(--ink-3)", display: "flex" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M4 8.5h11.5a4 4 0 0 1 0 8H9M6.5 5.5l-3 3 3 3M11.5 13.5l-3 3 3 3" />
            </svg>
          </span>
          <label htmlFor="repeats">Repeat this entry every month</label>
          <input
            id="repeats"
            type="checkbox"
            checked={repeats}
            onChange={(event) => setRepeats(event.target.checked)}
          />
        </div>
      </div>
    </Modal>
  );
}
