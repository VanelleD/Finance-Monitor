/** First run sets a passphrase; after that this is the sign-in screen. */

import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { deriveKey, passphraseProblem } from "../lib/crypto.js";
import { Icon } from "../lib/icons.js";
import { Banner, Button, TextField } from "../components/ui.js";

export function Gate({
  configured, onSignedIn,
}: { configured: boolean; onSignedIn: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!configured) {
      const problem = passphraseProblem(passphrase);
      if (problem) return setError(problem);
      if (passphrase !== confirmation) return setError("The two passphrases don't match.");
    } else if (passphrase.length === 0) {
      return setError("Enter your passphrase.");
    }

    setBusy(true);
    try {
      // Stretching happens here, in the browser: the server never sees the passphrase.
      const params = await api.authParams();
      const derivedKey = await deriveKey(passphrase, params);
      if (configured) await api.login(derivedKey);
      else await api.setup(derivedKey);
      setPassphrase("");
      setConfirmation("");
      onSignedIn();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate__card">
        <span className="wordmark__glyph" style={{ width: 40, height: 40, borderRadius: 12 }}>
          <Icon name="chart" size={22} strokeWidth={2.2} />
        </span>

        <h1 className="gate__title serif">{configured ? "Welcome back" : "Set your passphrase"}</h1>
        <p className="gate__blurb">
          {configured
            ? "Your ledger is locked behind this passphrase. Nothing else unlocks it."
            : "This is the only thing standing between your finances and anyone who finds the link. Pick a sentence you'll remember — length matters far more than symbols."}
        </p>

        <form className="gate__form" onSubmit={submit}>
          {error ? <Banner kind="error">{error}</Banner> : null}

          <TextField
            label="Passphrase"
            id="passphrase"
            type="password"
            icon="lock"
            autoComplete={configured ? "current-password" : "new-password"}
            autoFocus
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            hint={configured ? undefined : "At least 12 characters."}
          />

          {!configured ? (
            <TextField
              label="Type it again"
              id="confirmation"
              type="password"
              icon="lock"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          ) : null}

          <Button
            variant="primary"
            large
            block
            type="submit"
            disabled={busy}
            icon={busy ? undefined : "check"}
          >
            {busy ? "Checking…" : configured ? "Unlock" : "Create my ledger"}
          </Button>

          {!configured ? (
            <Banner kind="info">
              There is no password reset. This passphrase controls access, but it does not encrypt
              the database — if you forget it you will have to clear the stored verifier in the
              settings table to set a new one. Write it down somewhere safe.
            </Banner>
          ) : null}
        </form>
      </div>
    </div>
  );
}
