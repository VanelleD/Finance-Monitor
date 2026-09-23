import { useState } from "react";
import type { Account, Liability, Schedule } from "@shared/types.js";
import {
  dueOccurrences, monthlyEquivalentCents, ownedCents, totalLiabilitiesCents,
} from "@shared/derive.js";
import { formatBps, formatCents } from "@shared/money.js";
import { formatDate } from "@shared/dates.js";
import { api, type Snapshot } from "../lib/api.js";
import {
  ACCOUNT_KIND_LABELS, CADENCE_SHORT, COLOR, LIABILITY_KIND_LABELS,
  liabilityIcon, wash,
} from "../lib/present.js";
import { Icon, type IconName } from "../lib/icons.js";
import { Button, Card, CardHead, Chip, Empty, IconButton } from "../components/ui.js";
import { AccountDialog, SetBalanceDialog } from "../components/AccountDialogs.js";
import { LiabilityDialog } from "../components/HoldingDialog.js";
import { ScheduleDialog } from "../components/ScheduleDialog.js";

const ACCOUNT_ICONS: Record<Account["kind"], IconName> = {
  checking: "wallet",
  savings: "bank",
  cash: "wallet",
  brokerage: "chart",
  credit_card: "card",
};

export function Accounts({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: () => void }) {
  const [accountDialog, setAccountDialog] = useState<Account | "new" | null>(null);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);
  const [debtDialog, setDebtDialog] = useState<Liability | "new" | null>(null);
  const [ruleDialog, setRuleDialog] = useState<Schedule | "new" | null>(null);
  const [sourceName, setSourceName] = useState("");

  const accounts = snapshot.accounts.filter((a) => !a.archived);
  const debts = snapshot.liabilities.filter((l) => !l.archived);
  const rules = snapshot.schedules.filter((s) => !s.archived);
  const sources = snapshot.sources.filter((s) => !s.archived);

  const balanceOf = (account: Account) => snapshot.balances[account.id] ?? account.openingCents;
  const held = ownedCents(accounts, snapshot.balances, []);
  const owed = totalLiabilitiesCents(debts);

  async function removeAccount(account: Account) {
    if (!window.confirm(`Remove ${account.name}? Entries that pointed at it are kept, but lose their account.`)) return;
    await api.deleteAccount(account.id);
    onChanged();
  }

  async function removeDebt(debt: Liability) {
    if (!window.confirm(`Remove ${debt.name}? This can't be undone.`)) return;
    await api.deleteLiability(debt.id);
    onChanged();
  }

  async function removeRule(rule: Schedule) {
    if (!window.confirm(`Stop "${rule.name}"? Entries it already made are kept.`)) return;
    await api.deleteSchedule(rule.id);
    onChanged();
  }

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    const name = sourceName.trim();
    if (!name) return;
    await api.createSource(name);
    setSourceName("");
    onChanged();
  }

  return (
    <>
      <Card flush>
        <div className="statstrip">
          <div className="statstrip__cell">
            <span className="statstrip__label">In your accounts</span>
            <span className="statstrip__value num">{formatCents(held)}</span>
            <span className="statstrip__meta">
              across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">What you owe</span>
            <span className="statstrip__value num">{formatCents(owed)}</span>
            <span className="statstrip__meta">
              across {debts.length} {debts.length === 1 ? "debt" : "debts"}
            </span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">Difference</span>
            <span
              className="statstrip__value num"
              style={{ color: held - owed >= 0 ? "var(--up)" : "var(--down)" }}
            >
              {formatCents(held - owed, { signed: held - owed >= 0 })}
            </span>
            <span className="statstrip__meta">cash position, before other assets</span>
          </div>
          <div className="statstrip__cell">
            <span className="statstrip__label">Recurring rules</span>
            <span className="statstrip__value num">{rules.length}</span>
            <span className="statstrip__meta">
              {rules.filter((r) => r.autoPost).length} record themselves
            </span>
          </div>
        </div>
      </Card>

      {/* ------------------------------ accounts ------------------------------ */}
      <Card>
        <CardHead
          title="Where your money sits"
          sub="Balances come from your entries. Correct one whenever the bank disagrees."
          action={
            <Button variant="outline" icon="plus" onClick={() => setAccountDialog("new")}>
              Add account
            </Button>
          }
        />
        {accounts.length > 0 ? (
          <div className="tiles">
            {accounts.map((account) => (
              <div className="tile" key={account.id}>
                <div className="row tile__head">
                  <span
                    className="holding__glyph"
                    style={{ background: wash(COLOR.investment), color: COLOR.investment }}
                  >
                    <Icon name={ACCOUNT_ICONS[account.kind]} size={17} />
                  </span>
                  <span className="stack stack--gap-2 grow">
                    <span className="holding__name">{account.name}</span>
                    <span className="holding__meta">{ACCOUNT_KIND_LABELS[account.kind]}</span>
                  </span>
                  <IconButton name="pencil" label={`Edit ${account.name}`} bare onClick={() => setAccountDialog(account)} />
                  <IconButton name="trash" label={`Remove ${account.name}`} bare onClick={() => void removeAccount(account)} />
                </div>

                <p className="tile__figure num figure">{formatCents(balanceOf(account))}</p>

                <Button variant="dashed" icon="pencil" onClick={() => setBalanceFor(account)}>
                  Set balance
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="No accounts yet"
            action={
              <Button variant="primary" icon="plus" onClick={() => setAccountDialog("new")}>
                Add your first account
              </Button>
            }
          >
            Checking, savings, a brokerage, cash in a drawer — anywhere money sits.
          </Empty>
        )}
      </Card>

      {/* -------------------------------- debts ------------------------------- */}
      <Card>
        <CardHead
          title="What you owe"
          sub="Credit cards, buy-now-pay-later, loans, money owed to a person or an app"
          action={
            <Button variant="outline" icon="plus" onClick={() => setDebtDialog("new")}>
              Add debt
            </Button>
          }
        />
        {debts.length > 0 ? (
          <div className="tiles">
            {debts.map((debt) => (
              <div className="tile" key={debt.id}>
                <div className="row tile__head">
                  <span
                    className="holding__glyph"
                    style={{ background: wash(COLOR.liability), color: COLOR.liability }}
                  >
                    <Icon name={liabilityIcon(debt.kind)} size={17} />
                  </span>
                  <span className="stack stack--gap-2 grow">
                    <span className="holding__name">{debt.name}</span>
                    <span className="holding__meta">{LIABILITY_KIND_LABELS[debt.kind]}</span>
                  </span>
                  <IconButton name="pencil" label={`Edit ${debt.name}`} bare onClick={() => setDebtDialog(debt)} />
                  <IconButton name="trash" label={`Remove ${debt.name}`} bare onClick={() => void removeDebt(debt)} />
                </div>

                <p className="tile__figure num figure">{formatCents(debt.balanceCents)}</p>

                <div className="chip-row">
                  {debt.aprBps != null ? <Chip filled>{formatBps(debt.aprBps)} APR</Chip> : null}
                  {debt.minPaymentCents != null ? (
                    <Chip filled>{formatCents(debt.minPaymentCents)}/mo minimum</Chip>
                  ) : null}
                  {debt.dueDay != null ? <Chip filled>due on the {debt.dueDay}</Chip> : null}
                  {debt.aprBps == null && debt.minPaymentCents == null && debt.dueDay == null ? (
                    <span className="tiny muted">No rate or payment recorded</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Nothing owed"
            action={
              <Button variant="outline" icon="plus" onClick={() => setDebtDialog("new")}>
                Add a debt
              </Button>
            }
          >
            Add each card and app separately so a payoff target can track one of them.
          </Empty>
        )}
      </Card>

      {/* ------------------------------ recurring ----------------------------- */}
      <Card>
        <CardHead
          title="Money that moves on a schedule"
          sub="Paycheques, standing transfers, bills — anything that repeats"
          action={
            <Button variant="outline" icon="plus" onClick={() => setRuleDialog("new")}>
              Add rule
            </Button>
          }
        />
        {rules.length > 0 ? (
          <div className="stack">
            {rules.map((rule) => {
              const due = dueOccurrences(rule, snapshot.today).length;
              const perMonth = monthlyEquivalentCents(rule);
              const accountName = (id: string | null) =>
                snapshot.accounts.find((a) => a.id === id)?.name ?? "";
              return (
                <div className="holding rule-row" key={rule.id} style={{ cursor: "default" }}>
                  <span
                    className="holding__glyph"
                    style={{
                      background: wash(COLOR[rule.direction]),
                      color: COLOR[rule.direction],
                    }}
                  >
                    <Icon name="repeat" size={17} />
                  </span>

                  <span className="stack stack--gap-2 grow">
                    <span className="row" style={{ gap: 7 }}>
                      <span className="holding__name">{rule.name}</span>
                      {rule.autoPost ? <Chip filled>records itself</Chip> : null}
                      {rule.amountCents === null ? <Chip filled>amount varies</Chip> : null}
                      {due > 0 ? (
                        <span className="chip chip--status" style={{ color: "var(--warn)", background: wash("var(--warn)") }}>
                          <Icon name="alert" size={12} strokeWidth={2.1} />
                          {due} due
                        </span>
                      ) : null}
                    </span>
                    <span className="holding__meta">
                      {CADENCE_SHORT[rule.cadence]}
                      {rule.direction === "transfer" && rule.toAccountId
                        ? ` · ${accountName(rule.accountId)} → ${accountName(rule.toAccountId)}`
                        : rule.accountId
                          ? ` · ${accountName(rule.accountId)}`
                          : ""}
                      {` · next ${formatDate(rule.nextDue, true)}`}
                    </span>
                  </span>

                  <span className="holding__right">
                    <span className="holding__value num">
                      {rule.amountCents === null ? "varies" : formatCents(rule.amountCents)}
                    </span>
                    {perMonth > 0 && rule.cadence !== "monthly" ? (
                      <span className="holding__meta num">{formatCents(perMonth)}/mo</span>
                    ) : null}
                  </span>

                  <IconButton name="pencil" label={`Edit ${rule.name}`} bare onClick={() => setRuleDialog(rule)} />
                  <IconButton name="trash" label={`Stop ${rule.name}`} bare onClick={() => void removeRule(rule)} />
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title="Nothing recurring yet"
            action={
              <Button variant="outline" icon="plus" onClick={() => setRuleDialog("new")}>
                Add your first rule
              </Button>
            }
          >
            A rule whose amount is fixed can record itself. One whose amount changes waits for you
            to fill it in.
          </Empty>
        )}
      </Card>

      {/* --------------------------- income sources --------------------------- */}
      <Card>
        <CardHead title="Where money comes from" sub="Tag income so you can see what each source brings in" />
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {sources.length > 0 ? (
            sources.map((source) => <Chip key={source.id} filled>{source.name}</Chip>)
          ) : (
            <span className="tiny muted">None yet — a job, content, a side contract.</span>
          )}
        </div>
        <form className="row" style={{ gap: 10 }} onSubmit={addSource}>
          <div className="field__control" style={{ minHeight: 40, flex: 1, minWidth: 0 }}>
            <Icon name="bank" size={15} style={{ color: "var(--ink-3)" }} />
            <label className="visually-hidden" htmlFor="new-source">New money source</label>
            <input
              id="new-source"
              type="text"
              placeholder="Job, content, freelance…"
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
            />
          </div>
          <Button variant="outline" icon="plus" type="submit" disabled={!sourceName.trim()}>
            Add source
          </Button>
        </form>
      </Card>

      {accountDialog ? (
        <AccountDialog
          account={accountDialog === "new" ? undefined : accountDialog}
          onClose={() => setAccountDialog(null)}
          onSaved={onChanged}
        />
      ) : null}

      {balanceFor ? (
        <SetBalanceDialog
          account={balanceFor}
          currentCents={balanceOf(balanceFor)}
          snapshot={snapshot}
          onClose={() => setBalanceFor(null)}
          onSaved={onChanged}
        />
      ) : null}

      {debtDialog ? (
        <LiabilityDialog
          liability={debtDialog === "new" ? undefined : debtDialog}
          onClose={() => setDebtDialog(null)}
          onSaved={onChanged}
        />
      ) : null}

      {ruleDialog ? (
        <ScheduleDialog
          snapshot={snapshot}
          schedule={ruleDialog === "new" ? undefined : ruleDialog}
          onClose={() => setRuleDialog(null)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}
