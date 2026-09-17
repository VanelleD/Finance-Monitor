/**
 * Create or edit a target.
 *
 * The four kinds behave differently enough that the form rearranges itself
 * around the choice, rather than showing every field and hoping.
 */

import { useState } from "react";
import type { Target, TargetKind } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { api, ApiError, type Snapshot } from "../lib/api.js";
import { targetKind } from "../lib/present.js";
import { Banner, Button, Modal, SelectField, TextField } from "./ui.js";

const KINDS: TargetKind[] = ["save_to", "pay_off", "spend_under", "net_worth"];

const AMOUNT_LABEL: Record<TargetKind, string> = {
  save_to: "Amount to reach",
  pay_off: "Balance to clear",
  spend_under: "Monthly cap",
  net_worth: "Net worth to reach",
};

export function TargetDialog({
  snapshot, target, onClose, onSaved,
}: { snapshot: Snapshot; target?: Target; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(target?.name ?? "");
  const [kind, setKind] = useState<TargetKind>(target?.kind ?? "save_to");
  const [amount, setAmount] = useState(target ? formatCents(target.amountCents, { bare: true }) : "");
  const [deadline, setDeadline] = useState(target?.deadline ?? "");
  const [accountId, setAccountId] = useState(target?.accountId ?? "");
  const [liabilityId, setLiabilityId] = useState(target?.liabilityId ?? "");
  const [categoryId, setCategoryId] = useState(target?.categoryId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const spendCategories = snapshot.categories.filter((c) => !c.archived && c.direction === "out");
  const liabilities = snapshot.liabilities.filter((l) => !l.archived);

  async function save() {
    if (!name.trim()) return setErrors({ name: "Give the target a name." });
    const parsed = parseMoney(amount);
    if (!parsed.ok) return setErrors({ amountCents: parsed.error });
    if (parsed.cents <= 0) return setErrors({ amountCents: "Enter an amount above zero." });
    if (kind === "pay_off" && !liabilityId) {
      return setErrors({ liabilityId: "Choose which debt this clears." });
    }
    if (kind === "spend_under" && !categoryId) {
      return setErrors({ categoryId: "Choose which category the cap covers." });
    }

    // A payoff target needs a denominator: how much was owed when you started.
    const baselineCents =
      kind === "pay_off"
        ? (target?.baselineCents && target.baselineCents > 0
            ? target.baselineCents
            : parsed.cents)
        : 0;

    const payload = {
      name: name.trim(),
      kind,
      amountCents: parsed.cents,
      deadline: kind === "spend_under" ? null : deadline || null,
      accountId: kind === "save_to" ? accountId || null : null,
      liabilityId: kind === "pay_off" ? liabilityId || null : null,
      categoryId: kind === "spend_under" ? categoryId || null : null,
      baselineCents,
      archived: false,
    };

    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      if (target) await api.updateTarget(target.id, payload);
      else await api.createTarget(payload);
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? null : error.message);
      } else setFailure("Couldn't save that target.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={target ? "Edit target" : "New target"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save target"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <SelectField
          label="What kind of target"
          id="target-kind"
          icon="target"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as TargetKind);
            setErrors({});
          }}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>{targetKind(option).label}</option>
          ))}
        </SelectField>

        <TextField
          label="Name it"
          id="target-name"
          icon="note"
          autoComplete="off"
          placeholder={
            kind === "save_to" ? "Emergency fund"
            : kind === "pay_off" ? "Pay off the credit card"
            : kind === "spend_under" ? "Dining-out cap"
            : "Reach $150,000"
          }
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="field__row">
          <TextField
            label={AMOUNT_LABEL[kind]}
            id="target-amount"
            className="num"
            icon="wallet"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            error={errors.amountCents}
            onChange={(event) => setAmount(event.target.value)}
          />

          {kind === "spend_under" ? (
            <SelectField
              label="Which category"
              id="target-category"
              icon="tag"
              value={categoryId}
              error={errors.categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">— choose —</option>
              {spendCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </SelectField>
          ) : (
            <TextField
              label="Deadline"
              id="target-deadline"
              type="date"
              icon="calendar"
              value={deadline}
              error={errors.deadline}
              hint="Optional. With one, the app works out the pace you need."
              onChange={(event) => setDeadline(event.target.value)}
            />
          )}
        </div>

        {kind === "save_to" ? (
          <SelectField
            label="Where the money lands"
            id="target-account"
            icon="wallet"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            hint="Optional. Without it, progress comes from entries you tag with this target."
          >
            <option value="">Track by tagged entries</option>
            {snapshot.accounts.filter((a) => !a.archived).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </SelectField>
        ) : null}

        {kind === "pay_off" ? (
          <SelectField
            label="Which debt"
            id="target-liability"
            icon="card"
            value={liabilityId}
            error={errors.liabilityId}
            onChange={(event) => setLiabilityId(event.target.value)}
            hint={
              liabilities.length === 0
                ? "Add a liability on the Net worth screen first."
                : "Progress is measured against what you owed when you started."
            }
          >
            <option value="">— choose —</option>
            {liabilities.map((liability) => (
              <option key={liability.id} value={liability.id}>{liability.name}</option>
            ))}
          </SelectField>
        ) : null}
      </div>
    </Modal>
  );
}
