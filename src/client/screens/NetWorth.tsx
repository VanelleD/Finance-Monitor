import { useState } from "react";
import type { Asset, Liability } from "@shared/types.js";
import {
  byCarryingCost, netWorthCents, totalAssetsCents, totalLiabilitiesCents,
} from "@shared/derive.js";
import { formatBps, formatCents } from "@shared/money.js";
import { formatDate } from "@shared/dates.js";
import { api, type Snapshot } from "../lib/api.js";
import { assetGroup, assetIcon, ASSET_KIND_LABELS, liabilityIcon, LIABILITY_KIND_LABELS, wash } from "../lib/present.js";
import { Icon } from "../lib/icons.js";
import { Button, Card, CardHead, Empty, IconButton } from "../components/ui.js";
import { CompositionBar, CompositionLegend, type Segment } from "../components/charts.js";
import { AssetDialog, LiabilityDialog } from "../components/HoldingDialog.js";

export function NetWorth({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: () => void }) {
  const [editingAsset, setEditingAsset] = useState<Asset | "new" | null>(null);
  const [editingLiability, setEditingLiability] = useState<Liability | "new" | null>(null);

  const assets = snapshot.assets.filter((a) => !a.archived);
  const liabilities = snapshot.liabilities.filter((l) => !l.archived);
  const owned = totalAssetsCents(assets);
  const owed = totalLiabilitiesCents(liabilities);
  const worth = netWorthCents(assets, liabilities);

  // Asset kinds collapse onto three colour slots, so the bar never needs a fourth hue.
  const grouped = new Map<string, Segment>();
  for (const asset of assets) {
    const { label, color } = assetGroup(asset.kind);
    const existing = grouped.get(label);
    grouped.set(label, { label, color, cents: (existing?.cents ?? 0) + asset.valueCents });
  }
  const segments = [...grouped.values()].sort((a, b) => b.cents - a.cents);

  const ranked = byCarryingCost(liabilities);
  const costliest = ranked[0];
  const dueSoonCents = liabilities.reduce((total, l) => total + (l.minPaymentCents ?? 0), 0);

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Remove ${asset.name}? This can't be undone.`)) return;
    await api.deleteAsset(asset.id);
    onChanged();
  }

  async function removeLiability(liability: Liability) {
    if (!window.confirm(`Remove ${liability.name}? This can't be undone.`)) return;
    await api.deleteLiability(liability.id);
    onChanged();
  }

  return (
    <>
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
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Everything you own, less everything you owe.
            </p>

            <div style={{ marginTop: "auto", paddingTop: 12 }}>
              <div className="row" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
                <span className="swatch" style={{ background: "var(--series-3)" }} />
                <span className="small dim">What you own</span>
                <span className="num" style={{ marginLeft: "auto", fontWeight: 500 }}>
                  {formatCents(owned)}
                </span>
              </div>
              <div className="row" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
                <span className="swatch" style={{ background: "var(--series-6)" }} />
                <span className="small dim">What you owe</span>
                <span className="num" style={{ marginLeft: "auto", fontWeight: 500 }}>
                  {owed > 0 ? formatCents(-owed) : formatCents(0)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="What you own and owe" sub="Both bars share one scale" />
          {owned > 0 || owed > 0 ? (
            <>
              <div className="stack stack--gap-8">
                <div className="row">
                  <span className="small dim">Assets</span>
                  <span className="num tiny muted" style={{ marginLeft: "auto" }}>{formatCents(owned)}</span>
                </div>
                <CompositionBar segments={segments} totalCents={owned} />

                <div className="row" style={{ marginTop: 6 }}>
                  <span className="small dim">Liabilities</span>
                  <span className="num tiny muted" style={{ marginLeft: "auto" }}>
                    {formatCents(owed)}
                    {owned > 0 ? ` · ${Math.round((owed / owned) * 100)}% of assets` : ""}
                  </span>
                </div>
                <CompositionBar
                  segments={[{ label: "Liabilities", cents: owed, color: "var(--series-6)" }]}
                  totalCents={owed}
                  scaleTotalCents={Math.max(owned, owed)}
                />
              </div>
              <CompositionLegend segments={segments} totalCents={owned} />
            </>
          ) : (
            <Empty title="Nothing recorded yet">
              Add what you own and what you owe below, and this fills in.
            </Empty>
          )}
        </Card>
      </div>

      <div className="grid-wide">
        <Card>
          <div className="stack" style={{ height: "100%" }}>
            <CardHead
              title="What you own"
              sub={`${assets.length} ${assets.length === 1 ? "asset" : "assets"}`}
            />
            {assets.length > 0 ? (
              <div className="stack">
                {assets.map((asset) => (
                  <div className="row" key={asset.id} style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="holding"
                      onClick={() => setEditingAsset(asset)}
                    >
                      <span
                        className="holding__glyph"
                        style={{ background: wash("var(--series-3)"), color: "var(--series-3)" }}
                      >
                        <Icon name={assetIcon(asset.kind)} size={17} />
                      </span>
                      <span className="stack stack--gap-2 grow">
                        <span className="holding__name">{asset.name}</span>
                        <span className="holding__meta">{ASSET_KIND_LABELS[asset.kind]}</span>
                      </span>
                      <span className="holding__right">
                        <span className="holding__value num">{formatCents(asset.valueCents)}</span>
                        <span className="holding__meta num">valued {formatDate(asset.valuedOn, true)}</span>
                      </span>
                    </button>
                    <IconButton
                      name="trash"
                      label={`Remove ${asset.name}`}
                      bare
                      onClick={() => void removeAsset(asset)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No assets yet">Cash, savings, investments, a car, a house.</Empty>
            )}

            <div className="total-row">
              <span className="total-row__label">Total assets</span>
              <span className="total-row__value num">{formatCents(owned)}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Button variant="dashed" icon="plus" onClick={() => setEditingAsset("new")}>
                Add an asset
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="stack" style={{ height: "100%" }}>
            <CardHead
              title="What you owe"
              sub={
                dueSoonCents > 0
                  ? `${liabilities.length} ${liabilities.length === 1 ? "liability" : "liabilities"} · ${formatCents(dueSoonCents)} in minimum payments`
                  : `${liabilities.length} ${liabilities.length === 1 ? "liability" : "liabilities"}`
              }
            />
            {liabilities.length > 0 ? (
              <div className="stack">
                {liabilities.map((liability) => (
                  <div className="row" key={liability.id} style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="holding"
                      onClick={() => setEditingLiability(liability)}
                    >
                      <span
                        className="holding__glyph"
                        style={{ background: wash("var(--series-6)"), color: "var(--series-6)" }}
                      >
                        <Icon name={liabilityIcon(liability.kind)} size={17} />
                      </span>
                      <span className="stack stack--gap-2 grow">
                        <span className="holding__name">{liability.name}</span>
                        <span className="holding__meta">
                          {LIABILITY_KIND_LABELS[liability.kind]}
                          {liability.aprBps != null ? ` · ${formatBps(liability.aprBps)} APR` : ""}
                        </span>
                      </span>
                      <span className="holding__right">
                        <span className="holding__value num">{formatCents(liability.balanceCents)}</span>
                        <span className="holding__meta num">
                          {[
                            liability.minPaymentCents != null
                              ? `${formatCents(liability.minPaymentCents)}/mo`
                              : null,
                            liability.dueDay != null ? `due on the ${liability.dueDay}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                    <IconButton
                      name="trash"
                      label={`Remove ${liability.name}`}
                      bare
                      onClick={() => void removeLiability(liability)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No liabilities yet">
                Credit cards, loans, a mortgage. Nothing to add is good news.
              </Empty>
            )}

            {costliest && costliest.monthlyInterestCents > 0 ? (
              <div className="note-panel" style={{ marginTop: 14 }}>
                <span style={{ color: "var(--warn)", display: "flex" }}>
                  <Icon name="alert" size={16} strokeWidth={1.9} />
                </span>
                <span>
                  <span className="note-panel__title">
                    {costliest.name} costs the most to carry
                  </span>
                  <span className="note-panel__body">
                    At {costliest.aprBps != null ? formatBps(costliest.aprBps) : "its rate"} it accrues
                    about <span className="num">{formatCents(costliest.monthlyInterestCents)}</span> a
                    month. Clearing it before the others saves the most interest.
                  </span>
                </span>
              </div>
            ) : null}

            <div className="total-row">
              <span className="total-row__label">Total liabilities</span>
              <span className="total-row__value num">{formatCents(owed)}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Button variant="dashed" icon="plus" onClick={() => setEditingLiability("new")}>
                Add a liability
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {editingAsset ? (
        <AssetDialog
          snapshot={snapshot}
          asset={editingAsset === "new" ? undefined : editingAsset}
          onClose={() => setEditingAsset(null)}
          onSaved={onChanged}
        />
      ) : null}

      {editingLiability ? (
        <LiabilityDialog
          liability={editingLiability === "new" ? undefined : editingLiability}
          onClose={() => setEditingLiability(null)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}
