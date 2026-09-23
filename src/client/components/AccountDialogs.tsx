/** Creating, editing and correcting the places money sits. */

import { useState } from "react";
import type { Account } from "@shared/types.js";
import { formatCents, parseMoney } from "@shared/money.js";
import { api, ApiError, type Snapshot } from "../lib/api.js";
import { ACCOUNT_KIND_LABELS } from "../lib/present.js";
import { Banner, Button, Modal, SelectField, TextField } from "./ui.js";

const KINDS = Object.entries(ACCOUNT_KIND_LABELS) as Array<[Account["kind"], string]>;

export function AccountDialog({
  account, onClose, onSaved,
}: { account?: Account; onClose: () => void; onSaved: () => void }) {
  const editing = account !== undefined;
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(account?.kind ?? "checking");
  const [opening, setOpening] = useState(
    account ? formatCents(account.openingCents, { bare: true }) : "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setErrors({ name: "Give it a name." });
    const parsed = opening.trim() === "" ? { ok: true as const, cents: 0 } : parseMoney(opening);
    if (!parsed.ok) return setErrors({ openingCents: parsed.error });

    setSaving(true);
    setFailure(null);
    try {
      const payload = { name: name.trim(), kind, currency: "USD", openingCents: parsed.cents, archived: false };
      if (editing && account) await api.updateAccount(account.id, payload);
      else await api.createAccount(payload);
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit account" : "Add an account"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save account"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {failure ? <Banner kind="error">{failure}</Banner> : null}

        <TextField
          label="Name"
          id="account-name"
          icon="wallet"
          autoComplete="off"
          placeholder="Capital One 360 Savings"
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
            onChange={(event) => setKind(event.target.value as Account["kind"])}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectField>

          <TextField
            label={editing ? "Starting balance" : "Balance right now"}
            id="account-opening"
            className="num"
            icon="wallet"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={opening}
            error={errors.openingCents}
            hint={
              editing
                ? "Entries are added to this. To correct today's balance, use Edit balance instead."
                : "Entries you add later are counted on top of this."
            }
            onChange={(event) => setOpening(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Say what an account actually holds.
 *
 * The starting figure is left alone and the difference is recorded as a dated
 * correction, so the ledger keeps adding up and you can see when it was fixed.
 */
export function SetBalanceDialog({
  account, currentCents, snapshot, onClose, onSaved,
}: {
  account: Account;
  currentCents: number;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(formatCents(currentCents, { bare: true }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = parseMoney(value);
  const deltaCents = parsed.ok ? parsed.cents - currentCents : 0;

  async function save() {
    if (!parsed.ok) return setError(parsed.error);
    setSaving(true);
    setError(null);
    try {
      await api.setBalance(account.id, parsed.cents, snapshot.today);
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't save that balance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit ${account.name} balance`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Edit balance"}
          </Button>
        </>
      }
    >
      <div className="stack stack--gap-16">
        {error ? <Banner kind="error">{error}</Banner> : null}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small dim">The ledger currently says</span>
          <span className="num" style={{ fontWeight: 500 }}>{formatCents(currentCents)}</span>
        </div>

        <TextField
          label="What it really is"
          id="balance-value"
          className="num"
          icon="wallet"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0.00"
          value={value}
          error={parsed.ok ? undefined : parsed.error}
          onChange={(event) => setValue(event.target.value)}
        />

        {parsed.ok && deltaCents !== 0 ? (
          <Banner kind="info">
            A correction of{" "}
            <strong className="num">{formatCents(deltaCents, { signed: deltaCents > 0 })}</strong>{" "}
            will be recorded against today, so the balance comes out right and you can see why.
            It counts as neither income nor spending.
          </Banner>
        ) : null}

        {parsed.ok && deltaCents === 0 ? (
          <Banner kind="info">That already matches — nothing will be recorded.</Banner>
        ) : null}
      </div>
    </Modal>
  );
}
