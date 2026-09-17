/** Add or edit one asset or one liability. Same shape, different fields. */

import { useState } from "react";
import type { Asset, Liability } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { api, ApiError } from "../lib/api.js";
import type { Snapshot } from "../lib/api.js";
import { ASSET_KIND_LABELS, LIABILITY_KIND_LABELS } from "../lib/present.js";
import { Banner, Button, Modal, SelectField, TextField } from "./ui.js";

export function AssetDialog({
  snapshot, asset, onClose, onSaved,
}: { snapshot: Snapshot; asset?: Asset; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(asset?.name ?? "");
  const [kind, setKind] = useState<Asset["kind"]>(asset?.kind ?? "investment");
  const [value, setValue] = useState(asset ? formatCents(asset.valueCents, { bare: true }) : "");
  const [valuedOn, setValuedOn] = useState(asset?.valuedOn ?? snapshot.today);
  const [accountId, setAccountId] = useState(asset?.accountId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseMoney(value);
    if (!parsed.ok) return setErrors({ valueCents: parsed.error });
    if (parsed.cents < 0) return setErrors({ valueCents: "An asset can't be worth less than nothing." });
    if (!name.trim()) return setErrors({ name: "Give it a name." });

    const payload = {
      name: name.trim(),
      kind,
      valueCents: parsed.cents,
      valuedOn,
      accountId: accountId || null,
      archived: false,
    };

    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      if (asset) await api.updateAsset(asset.id, payload);
      else await api.createAsset(payload);
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? null : error.message);
      } else setFailure("Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={asset ? "Edit asset" : "Add an asset"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save asset"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <TextField
          label="What is it"
          id="asset-name"
          icon="note"
          autoComplete="off"
          placeholder="Fidelity Brokerage"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="field__row">
          <SelectField
            label="Kind"
            id="asset-kind"
            icon="tag"
            value={kind}
            onChange={(event) => setKind(event.target.value as Asset["kind"])}
          >
            {Object.entries(ASSET_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </SelectField>

          <TextField
            label="What it's worth"
            id="asset-value"
            className="num"
            icon="wallet"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value}
            error={errors.valueCents}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        <div className="field__row">
          <TextField
            label="Valued on"
            id="asset-valued-on"
            type="date"
            icon="calendar"
            value={valuedOn}
            error={errors.valuedOn}
            onChange={(event) => setValuedOn(event.target.value)}
          />
          <SelectField
            label="Linked account"
            id="asset-account"
            icon="wallet"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            hint="Link it when this asset simply is an account's balance."
          >
            <option value="">Not linked</option>
            {snapshot.accounts.filter((a) => !a.archived).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </SelectField>
        </div>
      </div>
    </Modal>
  );
}

export function LiabilityDialog({
  liability, onClose, onSaved,
}: { liability?: Liability; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(liability?.name ?? "");
  const [kind, setKind] = useState<Liability["kind"]>(liability?.kind ?? "credit_card");
  const [balance, setBalance] = useState(
    liability ? formatCents(liability.balanceCents, { bare: true }) : "",
  );
  const [apr, setApr] = useState(liability?.aprBps != null ? (liability.aprBps / 100).toFixed(2) : "");
  const [minPayment, setMinPayment] = useState(
    liability?.minPaymentCents != null ? formatCents(liability.minPaymentCents, { bare: true }) : "",
  );
  const [dueDay, setDueDay] = useState(liability?.dueDay != null ? String(liability.dueDay) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setErrors({ name: "Give it a name." });
    const parsedBalance = parseMoney(balance);
    if (!parsedBalance.ok) return setErrors({ balanceCents: parsedBalance.error });
    if (parsedBalance.cents < 0) return setErrors({ balanceCents: "Enter the balance as a positive figure." });

    let aprBps: number | null = null;
    if (apr.trim() !== "") {
      const rate = Number(apr);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
        return setErrors({ aprBps: "Enter a rate like 21.24" });
      }
      aprBps = Math.round(rate * 100);
    }

    let minPaymentCents: number | null = null;
    if (minPayment.trim() !== "") {
      const parsed = parseMoney(minPayment);
      if (!parsed.ok) return setErrors({ minPaymentCents: parsed.error });
      minPaymentCents = Math.abs(parsed.cents);
    }

    let day: number | null = null;
    if (dueDay.trim() !== "") {
      day = Number(dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return setErrors({ dueDay: "A day of the month, 1 to 31." });
      }
    }

    const payload = {
      name: name.trim(), kind, balanceCents: parsedBalance.cents,
      aprBps, minPaymentCents, dueDay: day, archived: false,
    };

    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      if (liability) await api.updateLiability(liability.id, payload);
      else await api.createLiability(payload);
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? null : error.message);
      } else setFailure("Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={liability ? "Edit liability" : "Add a liability"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save liability"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <TextField
          label="What do you owe"
          id="liability-name"
          icon="note"
          autoComplete="off"
          placeholder="Sapphire credit card"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="field__row">
          <SelectField
            label="Kind"
            id="liability-kind"
            icon="tag"
            value={kind}
            onChange={(event) => setKind(event.target.value as Liability["kind"])}
          >
            {Object.entries(LIABILITY_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </SelectField>

          <TextField
            label="Balance owed"
            id="liability-balance"
            className="num"
            icon="card"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={balance}
            error={errors.balanceCents}
            onChange={(event) => setBalance(event.target.value)}
          />
        </div>

        <div className="field__row">
          <TextField
            label="Interest rate (APR %)"
            id="liability-apr"
            className="num"
            icon="chart"
            inputMode="decimal"
            autoComplete="off"
            placeholder="21.24"
            value={apr}
            error={errors.aprBps}
            hint="Optional, but it's what decides which debt to clear first."
            onChange={(event) => setApr(event.target.value)}
          />
          <TextField
            label="Minimum payment"
            id="liability-min"
            className="num"
            icon="wallet"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={minPayment}
            error={errors.minPaymentCents}
            onChange={(event) => setMinPayment(event.target.value)}
          />
        </div>

        <TextField
          label="Due day of the month"
          id="liability-due"
          className="num"
          icon="calendar"
          inputMode="numeric"
          autoComplete="off"
          placeholder="3"
          value={dueDay}
          error={errors.dueDay}
          onChange={(event) => setDueDay(event.target.value)}
        />
      </div>
    </Modal>
  );
}

export function AccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"checking" | "savings" | "cash" | "brokerage" | "credit_card">("checking");
  const [opening, setOpening] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setErrors({ name: "Give it a name." });
    const parsed = opening.trim() === "" ? { ok: true as const, cents: 0 } : parseMoney(opening);
    if (!parsed.ok) return setErrors({ openingCents: parsed.error });

    setSaving(true);
    try {
      await api.createAccount({
        name: name.trim(), kind, currency: "USD", openingCents: parsed.cents, archived: false,
      });
      onSaved();
      onClose();
    } catch {
      setErrors({ name: "Couldn't save that account." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add a money source"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save source"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        <TextField
          label="Name"
          id="account-name"
          icon="wallet"
          autoComplete="off"
          placeholder="Chase Checking"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="field__row">
          <SelectField
            label="Kind"
            id="account-kind"
            icon="bank"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="cash">Cash</option>
            <option value="brokerage">Brokerage</option>
            <option value="credit_card">Credit card</option>
          </SelectField>
          <TextField
            label="Balance today"
            id="account-opening"
            className="num"
            icon="wallet"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={opening}
            error={errors.openingCents}
            hint="Entries are added to this figure."
            onChange={(event) => setOpening(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
