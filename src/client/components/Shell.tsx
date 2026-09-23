/** Navigation chrome: sidebar on desktop, bottom tab bar plus a floating action on mobile. */

import type { ReactNode } from "react";
import { Icon, type IconName } from "../lib/icons.js";
import { IconButton } from "./ui.js";

export type Route = "dashboard" | "ledger" | "accounts" | "worth" | "targets";

export const ROUTES: Array<{ route: Route; path: string; label: string; short: string; icon: IconName }> = [
  { route: "dashboard", path: "/", label: "Dashboard", short: "Home", icon: "grid" },
  { route: "ledger", path: "/ledger", label: "Transactions", short: "Ledger", icon: "flow" },
  { route: "accounts", path: "/accounts", label: "Accounts", short: "Accounts", icon: "wallet" },
  { route: "worth", path: "/worth", label: "Net worth", short: "Worth", icon: "scale" },
  { route: "targets", path: "/targets", label: "Targets", short: "Targets", icon: "target" },
];

export function Shell({
  route, onNavigate, onAdd, onToggleTheme, theme, onSignOut, children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  onAdd: () => void;
  onToggleTheme: () => void;
  theme: "dark" | "light";
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="wordmark">
          <span className="wordmark__glyph">
            <Icon name="chart" size={15} strokeWidth={2.3} />
          </span>
          <span className="wordmark__text serif">Ledger</span>
        </div>

        <nav className="nav" aria-label="Main">
          {ROUTES.map((item) => (
            <button
              key={item.route}
              type="button"
              className="nav__link"
              aria-current={route === item.route ? "page" : undefined}
              onClick={() => onNavigate(item.route)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__who">
            <span className="avatar" aria-hidden="true">
              <Icon name="lock" size={15} />
            </span>
            <span className="stack stack--gap-2 grow">
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>My finances</span>
              <span className="tiny muted">Private &middot; passphrase only</span>
            </span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="nav__link" style={{ minHeight: 38 }} onClick={onToggleTheme}>
              <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
              <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
            </button>
            <IconButton name="logout" label="Sign out" bare onClick={onSignOut} />
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>

      <button type="button" className="fab" aria-label="Add entry" onClick={onAdd}>
        <Icon name="plus" size={24} strokeWidth={2.3} />
      </button>

      <nav className="tabbar" aria-label="Main">
        {ROUTES.map((item) => (
          <button
            key={item.route}
            type="button"
            className="tabbar__link"
            aria-current={route === item.route ? "page" : undefined}
            onClick={() => onNavigate(item.route)}
          >
            <Icon name={item.icon} size={20} strokeWidth={1.8} />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <h1 className="topbar__title serif">{title}</h1>
      {children ? <div className="topbar__actions">{children}</div> : null}
    </header>
  );
}
