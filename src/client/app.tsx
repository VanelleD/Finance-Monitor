import { useCallback, useEffect, useState } from "react";
import type { Entry } from "@shared/types.js";
import { currentMonth } from "@shared/dates.js";
import { api, ApiError, type Snapshot } from "./lib/api.js";
import { Shell, TopBar, ROUTES, type Route } from "./components/Shell.js";
import { Banner, Button, Card, IconButton, MonthNav, Spinner } from "./components/ui.js";
import { EntryDialog } from "./components/EntryDialog.js";
import { AccountDialog } from "./components/HoldingDialog.js";
import { Gate } from "./screens/Gate.js";
import { Dashboard } from "./screens/Dashboard.js";
import { Ledger } from "./screens/Ledger.js";
import { NetWorth } from "./screens/NetWorth.js";
import { Targets } from "./screens/Targets.js";

type Theme = "dark" | "light";
type AuthState = { configured: boolean; authenticated: boolean } | null;

function routeFromPath(path: string): Route {
  return ROUTES.find((item) => item.path === path)?.route ?? "dashboard";
}

function pathForRoute(route: Route): string {
  return ROUTES.find((item) => item.route === route)?.path ?? "/";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [auth, setAuth] = useState<AuthState>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  const [month, setMonth] = useState(currentMonth());

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [entryDialog, setEntryDialog] = useState<Entry | "new" | null>(null);
  const [accountDialog, setAccountDialog] = useState(false);

  /* -------------------------------- theme -------------------------------- */

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ledger.theme", theme);
    } catch {
      // Private browsing can refuse storage; the theme just won't persist.
    }
  }, [theme]);

  /* --------------------------------- auth -------------------------------- */

  useEffect(() => {
    void api
      .authState()
      .then(setAuth)
      .catch(() => setAuthError("Can't reach the server."));
  }, []);

  /* ------------------------------- routing ------------------------------- */

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    window.history.pushState(null, "", pathForRoute(next));
  }, []);

  /* --------------------------------- data -------------------------------- */

  const reload = useCallback(
    async (targetMonth: string) => {
      try {
        setSnapshot(await api.snapshot(targetMonth));
        setLoadError(null);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setAuth({ configured: true, authenticated: false });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Couldn't load your data.");
      }
    },
    [],
  );

  useEffect(() => {
    if (auth?.authenticated) void reload(month);
  }, [auth?.authenticated, month, reload]);

  const refresh = useCallback(() => void reload(month), [reload, month]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    setSnapshot(null);
    setAuth({ configured: true, authenticated: false });
  }

  /* -------------------------------- render ------------------------------- */

  if (authError) {
    return (
      <div className="gate">
        <div className="gate__card">
          <Banner kind="error">{authError}</Banner>
        </div>
      </div>
    );
  }

  if (auth === null) {
    return <Spinner label="Starting up" />;
  }

  if (!auth.authenticated) {
    return (
      <Gate
        configured={auth.configured}
        onSignedIn={() => setAuth({ configured: true, authenticated: true })}
      />
    );
  }

  const title = ROUTES.find((item) => item.route === route)?.label ?? "Dashboard";
  const showMonthNav = route === "dashboard" || route === "ledger";

  return (
    <>
      <Shell
        route={route}
        onNavigate={navigate}
        onAdd={() => setEntryDialog("new")}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        theme={theme}
        onSignOut={() => void signOut()}
      >
        <TopBar title={title}>
          {showMonthNav ? <MonthNav month={month} onChange={setMonth} /> : null}
          {route === "worth" ? (
            <Button variant="outline" icon="plus" onClick={() => setAccountDialog(true)}>
              Add money source
            </Button>
          ) : null}
          <span className="hide-mobile">
            <Button variant="primary" icon="plus" onClick={() => setEntryDialog("new")}>
              Add entry
            </Button>
          </span>
          <span className="hide-mobile">
            <IconButton
              name={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Switch to light" : "Switch to dark"}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            />
          </span>
        </TopBar>

        <div className="content">
          {loadError ? <Banner kind="error">{loadError}</Banner> : null}

          {snapshot === null ? (
            <Spinner label="Loading your ledger" />
          ) : (
            <>
              {snapshot.accounts.length === 0 ? (
                <Card>
                  <div className="row row--wrap" style={{ gap: 12 }}>
                    <span className="stack stack--gap-4 grow">
                      <span style={{ fontWeight: 600 }}>Add a money source to get started</span>
                      <span className="small dim">
                        A money source is wherever your money sits — a checking account, savings, cash.
                        Entries attach to one, and balances follow from there.
                      </span>
                    </span>
                    <Button variant="primary" icon="plus" onClick={() => setAccountDialog(true)}>
                      Add money source
                    </Button>
                  </div>
                </Card>
              ) : null}

              {route === "dashboard" ? (
                <Dashboard
                  snapshot={snapshot}
                  month={month}
                  onAdd={() => setEntryDialog("new")}
                  onGoTo={navigate}
                  onEditEntry={setEntryDialog}
                />
              ) : null}

              {route === "ledger" ? (
                <Ledger
                  snapshot={snapshot}
                  month={month}
                  onEditEntry={setEntryDialog}
                  onChanged={refresh}
                />
              ) : null}

              {route === "worth" ? <NetWorth snapshot={snapshot} onChanged={refresh} /> : null}

              {route === "targets" ? <Targets snapshot={snapshot} onChanged={refresh} /> : null}
            </>
          )}
        </div>
      </Shell>

      {entryDialog && snapshot ? (
        <EntryDialog
          snapshot={snapshot}
          entry={entryDialog === "new" ? undefined : entryDialog}
          onClose={() => setEntryDialog(null)}
          onSaved={refresh}
        />
      ) : null}

      {accountDialog ? (
        <AccountDialog onClose={() => setAccountDialog(false)} onSaved={refresh} />
      ) : null}
    </>
  );
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("ledger.theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can throw in private mode; dark-first is the default anyway.
  }
  return "dark";
}
