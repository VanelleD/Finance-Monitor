import { useEffect, useState } from "react";
import type { Direction, Entry } from "@shared/types.js";
import { formatCents } from "@shared/money.js";
import { flowForMonth } from "@shared/derive.js";
import { formatDate, formatMonth } from "@shared/dates.js";
import { api, ApiError, type Snapshot } from "../lib/api.js";
import { COLOR, directionColor } from "../lib/present.js";
import { Icon } from "../lib/icons.js";
import {
  Banner, Card, Chip, Empty, IconButton, Segmented, Spinner, Swatch,
} from "../components/ui.js";

const PAGE_SIZE = 25;

type Filter = Direction | "all";

const FILTERS: Array<{ value: Filter; label: string; dot?: string }> = [
  { value: "all", label: "All" },
  { value: "in", label: "Money in", dot: COLOR.in },
  { value: "out", label: "Money out", dot: COLOR.out },
  { value: "transfer", label: "Transfers", dot: COLOR.transfer },
];

export function Ledger({
  snapshot, month, onEditEntry, onChanged,
}: {
  snapshot: Snapshot;
  month: string;
  onEditEntry: (entry: Entry) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Any filter change puts you back on the first page; otherwise page 3 of a
  // narrower result set silently shows nothing.
  useEffect(() => {
    setPage(0);
  }, [filter, categoryId, accountId, search, month]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      void api
        .entries({
          month,
          direction: filter === "all" ? undefined : filter,
          categoryId: categoryId || undefined,
          accountId: accountId || undefined,
          search: search.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        .then((result) => {
          if (cancelled) return;
          setRows(result.entries);
          setTotal(result.total);
          setError(null);
        })
        .catch((failure) => {
          if (cancelled) return;
          setError(failure instanceof ApiError ? failure.message : "Couldn't load entries.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, search ? 220 : 0); // debounce only while typing

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [month, filter, categoryId, accountId, search, page]);

  const flow = flowForMonth(snapshot.entries, month);
  const categoryName = (id: string | null) => snapshot.categories.find((c) => c.id === id)?.name ?? "";
  const accountName = (id: string | null) => snapshot.accounts.find((a) => a.id === id)?.name ?? "";
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  async function removeEntry(entry: Entry) {
    const label = entry.payee || categoryName(entry.categoryId) || "this entry";
    if (!window.confirm(`Delete ${label} for ${formatCents(entry.amountCents)}? This can't be undone.`)) {
      return;
    }
    setDeleting(entry.id);
    try {
      await api.deleteEntry(entry.id);
      setRows((current) => current.filter((row) => row.id !== entry.id));
      setTotal((current) => Math.max(0, current - 1));
      onChanged();
    } catch {
      setError("Couldn't delete that entry.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="row row--wrap" style={{ gap: 10 }}>
        <Segmented label="Filter by direction" options={FILTERS} value={filter} onChange={setFilter} />

        <div className="field__control" style={{ minHeight: 38, minWidth: 0 }}>
          <Icon name="tag" size={15} style={{ color: "var(--ink-3)" }} />
          <label className="visually-hidden" htmlFor="filter-category">Category</label>
          <select
            id="filter-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {snapshot.categories.filter((c) => !c.archived).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} style={{ color: "var(--ink-3)" }} />
        </div>

        <div className="field__control" style={{ minHeight: 38, minWidth: 0 }}>
          <Icon name="wallet" size={15} style={{ color: "var(--ink-3)" }} />
          <label className="visually-hidden" htmlFor="filter-account">Money source</label>
          <select
            id="filter-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">All sources</option>
            {snapshot.accounts.filter((a) => !a.archived).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} style={{ color: "var(--ink-3)" }} />
        </div>

        <div className="field__control" style={{ minHeight: 38, flex: 1, minWidth: 180 }}>
          <Icon name="search" size={15} style={{ color: "var(--ink-3)" }} />
          <label className="visually-hidden" htmlFor="filter-search">Search entries</label>
          <input
            id="filter-search"
            type="search"
            placeholder="Search payee or reason"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <a className="btn btn--outline" href="/api/export.csv" download>
          <Icon name="download" size={16} strokeWidth={2.1} />
          Export CSV
        </a>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}

      <Card flush>
        {loading && rows.length === 0 ? (
          <Spinner label="Loading entries" />
        ) : rows.length === 0 ? (
          <Empty title={`No entries match in ${formatMonth(month)}`}>
            Try widening the filters, or pick a different month.
          </Empty>
        ) : (
          <div className="table__wrap">
            <table className="table">
              <caption className="visually-hidden">
                Entries for {formatMonth(month)}, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col"><span className="visually-hidden">Direction</span></th>
                  <th scope="col">Description</th>
                  <th scope="col">Reason / note</th>
                  <th scope="col">Category</th>
                  <th scope="col">Money source</th>
                  <th scope="col" className="table__num">Amount</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const transfer = entry.direction === "transfer";
                  return (
                    <tr key={entry.id} style={{ opacity: deleting === entry.id ? 0.4 : 1 }}>
                      <td className="num tiny muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(entry.occurredOn, true)}
                      </td>
                      <td><Swatch color={directionColor(entry.direction)} /></td>
                      <td style={{ fontWeight: 500, maxWidth: 220 }} className="truncate">
                        {entry.payee || <span className="muted">No description</span>}
                      </td>
                      <td className="truncate muted" style={{ maxWidth: 240 }}>{entry.reason}</td>
                      <td>
                        {transfer ? (
                          <Chip filled>Transfer</Chip>
                        ) : entry.categoryId ? (
                          <Chip filled>{categoryName(entry.categoryId)}</Chip>
                        ) : (
                          <span className="muted tiny">&mdash;</span>
                        )}
                      </td>
                      <td className="dim truncate" style={{ maxWidth: 160 }}>
                        {transfer
                          ? `${accountName(entry.accountId)} → ${accountName(entry.toAccountId)}`
                          : accountName(entry.accountId)}
                      </td>
                      <td
                        className="table__num num"
                        style={{
                          fontWeight: 500,
                          color: entry.direction === "in" ? "var(--up)" : transfer ? "var(--ink-2)" : "var(--ink)",
                        }}
                      >
                        {formatCents(entry.amountCents, { signed: entry.direction === "in" })}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                          <IconButton name="pencil" label="Edit this entry" bare onClick={() => onEditEntry(entry)} />
                          <IconButton
                            name="trash"
                            label="Delete this entry"
                            bare
                            disabled={deleting === entry.id}
                            onClick={() => void removeEntry(entry)}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table__foot">
          <span>
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}&ndash;
            {Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
          </span>
          <span className="row" style={{ gap: 4 }}>
            <IconButton
              name="chevronLeft"
              label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            />
            <IconButton
              name="chevronRight"
              label="Next page"
              disabled={page >= lastPage}
              onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
            />
          </span>
          <span className="grow" />
          <span className="table__total">
            <Swatch color={COLOR.in} />In<span className="num">{formatCents(flow.inCents)}</span>
          </span>
          <span className="table__total">
            <Swatch color={COLOR.out} />Out<span className="num">{formatCents(flow.outCents)}</span>
          </span>
          <span className="table__total">
            Left over
            <span className="num" style={{ color: flow.netCents >= 0 ? "var(--up)" : "var(--down)" }}>
              {formatCents(flow.netCents, { signed: flow.netCents >= 0 })}
            </span>
          </span>
        </div>
      </Card>
    </>
  );
}
