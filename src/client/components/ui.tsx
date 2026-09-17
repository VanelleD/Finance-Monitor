/** The component vocabulary from the Foundations board. */

import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../lib/icons.js";
import { statusChip, wash } from "../lib/present.js";
import type { TargetStatus } from "@shared/types.js";
import { addMonths, currentMonth, formatMonth } from "@shared/dates.js";

/* ---------------------------------- cards --------------------------------- */

export function Card({
  children, flush = false, className = "", style,
}: { children: ReactNode; flush?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`card${flush ? " card--flush" : ""} ${className}`} style={style}>
      {children}
    </section>
  );
}

export function CardHead({
  title, sub, action,
}: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card__head">
      <div className="grow">
        <h2 className="card__title">{title}</h2>
        {sub ? <p className="card__sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- buttons -------------------------------- */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "dashed";

export function Button({
  children, variant = "outline", icon, large = false, block = false, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
  large?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn--${variant}${large ? " btn--lg" : ""}${block ? " btn--block" : ""}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={large ? 18 : 16} strokeWidth={2.1} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  name, label, bare = false, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  name: IconName;
  label: string;
  bare?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${bare ? " icon-btn--bare" : ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={name} size={16} />
    </button>
  );
}

/* --------------------------------- fields --------------------------------- */

export function Field({
  label, id, icon, error, children, hint,
}: {
  label: string;
  id: string;
  icon?: IconName;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className={`field__control${error ? " field__control--invalid" : ""}`}>
        {icon ? <Icon name={icon} size={15} style={{ color: "var(--ink-3)" }} /> : null}
        {children}
        {/* A select needs its own affordance; a text input does not. */}
      </div>
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__error muted" style={{ color: "var(--ink-3)" }}>{hint}</span> : null}
    </div>
  );
}

export function TextField({
  label, id, icon, error, hint, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  icon?: IconName;
  error?: string;
  hint?: string;
}) {
  return (
    <Field label={label} id={id} icon={icon} error={error} hint={hint}>
      <input id={id} type="text" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function SelectField({
  label, id, icon, error, hint, children, ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  icon?: IconName;
  error?: string;
  hint?: string;
}) {
  return (
    <Field label={label} id={id} icon={icon} error={error} hint={hint}>
      <select id={id} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={14} style={{ color: "var(--ink-3)" }} />
    </Field>
  );
}

/* -------------------------------- segmented ------------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  dot?: string;
}

export function Segmented<T extends string>({
  options, value, onChange, fill = false, label,
}: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
  label: string;
}) {
  return (
    <div className={`segmented${fill ? " segmented--fill" : ""}`} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="segmented__btn"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            style={
              selected && option.dot
                ? { background: wash(option.dot), borderColor: option.dot, color: "var(--ink)" }
                : undefined
            }
          >
            {option.dot ? <span className="swatch" style={{ background: option.dot }} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- month nav ------------------------------ */

export function MonthNav({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const atLatest = month >= currentMonth();
  return (
    <div className="monthnav">
      <button
        type="button"
        className="monthnav__btn"
        aria-label="Previous month"
        onClick={() => onChange(addMonths(month, -1))}
      >
        <Icon name="chevronLeft" size={15} />
      </button>
      <span className="monthnav__label num">{formatMonth(month, true)}</span>
      <button
        type="button"
        className="monthnav__btn"
        aria-label="Next month"
        disabled={atLatest}
        title={atLatest ? "This is the current month" : "Next month"}
        onClick={() => onChange(addMonths(month, 1))}
      >
        <Icon name="chevronRight" size={15} />
      </button>
    </div>
  );
}

/* ---------------------------------- chips --------------------------------- */

export function Chip({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return <span className={`chip${filled ? " chip--filled" : ""}`}>{children}</span>;
}

export function StatusChip({ status }: { status: TargetStatus }) {
  const { label, color, icon } = statusChip(status);
  return (
    <span className="chip chip--status" style={{ color, background: wash(color) }}>
      <Icon name={icon} size={13} strokeWidth={2.1} />
      {label}
    </span>
  );
}

/* --------------------------------- figures -------------------------------- */

export function Delta({ children, good }: { children: ReactNode; good: boolean }) {
  return (
    <span className={`delta delta--${good ? "up" : "down"}`}>
      <Icon name={good ? "upRight" : "downLeft"} size={13} strokeWidth={2.1} />
      <span className="num">{children}</span>
    </span>
  );
}

export function Meter({
  fraction, color, thin = false, label,
}: { fraction: number; color: string; thin?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <span
      className={`meter${thin ? " meter--thin" : ""}`}
      style={{ background: `color-mix(in srgb, ${color} 20%, var(--card))` }}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span className="meter__fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

/* --------------------------------- feedback ------------------------------- */

export function Banner({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === "error" ? "alert" : undefined}>
      <Icon name={kind === "error" ? "alert" : "note"} size={15} strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}

export function Empty({
  title, children, action,
}: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <p style={{ maxWidth: "42ch" }}>{children}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="empty">
      <span className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

/* ---------------------------------- modal --------------------------------- */

/**
 * A dialog that behaves like one: Escape closes it, a click on the scrim closes
 * it, focus moves inside on open and back where it came from on close, and Tab
 * stays within it.
 */
export function Modal({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    const firstField = panel.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), select, textarea, button",
    );
    firstField?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" ref={panel} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h2 className="modal__title serif">{title}</h2>
          <IconButton name="close" label="Close without saving" onClick={onClose} />
        </div>
        {children}
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
