import { useCallback, useEffect, useRef, useState } from "react";

import FreeTierPanel from "./FreeTierPanel";
import {
  describeError,
  getOmniRouteKeySync,
  listAgentProfiles,
  setOmniRouteKeySync,
} from "../lib/ipc";
import {
  PROVIDER_POLL_MS,
  formatProviderObservedAt,
  formatProviderResetsAt,
  isUsageStale,
  providerDetailText,
  providerKindLabel,
  providerQuotaLabel,
  providerUsageFillClass,
  routedProfilesForProvider,
  useProviderKey,
  useProviderOverview,
  vaultErrorText,
} from "../lib/providers";
import { useFocusTrap } from "../lib/useFocusTrap";
import type { AgentProfile, Provider } from "../types";

interface ProviderDialogProps {
  onClose: () => void;
}

/**
 * The provider whose vault entry unlocks OmniRoute's login-gated management
 * routes. It is registered as a local provider rather than an API-key one, so
 * the key controls are offered for it explicitly - without a token there are
 * no free-tier numbers, and the dialog is where a person would go looking for
 * the place to put one.
 */
const OMNIROUTE_ID = "omniroute";

/**
 * Provider overview: connection state, quota, key management for API-key
 * providers, the OmniRoute fallback status and what is left in its free pools.
 * Refreshes on open and every 30 seconds while open. Escape and the backdrop
 * close the dialog.
 */
export default function ProviderDialog({ onClose }: ProviderDialogProps) {
  const { providers, loading, error, vaultError, refresh } =
    useProviderOverview(PROVIDER_POLL_MS);
  // Profiles are read once: they change when somebody edits `agents.json` and
  // restarts, not while a dialog is open.
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);

  useEffect(() => {
    let alive = true;
    void listAgentProfiles()
      .then((next) => {
        if (alive) setProfiles(next);
      })
      .catch(() => {
        // A profile list that did not load costs a badge, not the dialog.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);

  const keySync = useOmniRouteKeySync();

  // Three states, not two. `some()` over the empty list of a first load is
  // `false`, which used to make this header assert "offline" for the couple of
  // seconds the probe takes - while the status bar, reading the same fact from
  // the quota tracker, said online right below it. An unknown answer is not a
  // negative one.
  const omniRoute: "online" | "offline" | "unknown" = loading
    ? "unknown"
    : providers.some((provider) => provider.omniRouteOnline)
      ? "online"
      : "offline";
  const omniRouteLabel =
    omniRoute === "unknown" ? "OmniRoute wird geprüft …" : `OmniRoute ${omniRoute}`;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal provider-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Provider"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">Provider</div>
        <div className="modal-body provider-body">
          <div className="provider-header">
            <span
              className={`provider-omni-status${
                omniRoute === "online" ? " provider-omni-online" : ""
              }${omniRoute === "unknown" ? " provider-omni-unknown" : ""}`}
              title={omniRouteLabel}
            >
              <span className="provider-omni-dot" aria-hidden="true" />
              {omniRouteLabel}
            </span>
            <span className="provider-header-hint">
              {keySync.enabled
                ? "Gespeicherte API-Keys speisen das OmniRoute-Routing."
                : "Gespeicherte API-Keys bleiben im lokalen Vault."}
            </span>
          </div>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={keySync.enabled}
              disabled={!keySync.usable}
              onChange={(event) => keySync.toggle(event.target.checked)}
            />
            <span>API-Keys an OmniRoute übergeben</span>
          </label>
          <p className="settings-hint">
            Aus: Keys verlassen den lokalen Vault nicht. An: ProjectA übergibt alle
            gespeicherten Provider-Keys an den lokalen OmniRoute-Prozess — an jeden
            Prozess, der auf dessen Port antwortet, ohne Identitätsprüfung. Nur
            einschalten, wenn du diesem Rechner und dem OmniRoute darauf vertraust.
          </p>
          {keySync.error ? (
            <div className="modal-note modal-error" role="alert">
              {keySync.error}
            </div>
          ) : null}

          {loading ? <div className="modal-note">Lade Provider…</div> : null}
          {!loading && providers.length === 0 && error === null ? (
            <div className="modal-note">Keine Provider konfiguriert.</div>
          ) : null}

          {vaultError ? (
            <div className="modal-note modal-error" role="alert" title={vaultError}>
              {vaultErrorText(vaultError)}
            </div>
          ) : null}

          {providers.length > 0 ? (
            <ul className="provider-list">
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  routed={routedProfilesForProvider(provider.id, profiles)}
                />
              ))}
            </ul>
          ) : null}

          {error ? <div className="modal-note modal-error">{error}</div> : null}

          <FreeTierPanel />

          <button
            type="button"
            className="button-subtle provider-refresh"
            onClick={() => {
              refresh();
              keySync.reload();
            }}
            disabled={loading}
          >
            Aktualisieren
          </button>
        </div>
        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The F-SEC-4 opt-in: whether ProjectA hands the vault's provider keys to the
 * local OmniRoute process. The switch lives in the core's settings table, and
 * the box starts unchecked and disabled until the core has answered, so a slow
 * read never shows "on" for a sync that is off. A read that failed stays
 * disabled rather than guessing; "Aktualisieren" asks again. The box is locked
 * while a write is in flight, and a failed write takes it back, like the other
 * switches.
 */
function useOmniRouteKeySync() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every read and every write takes a new generation, and a read only lands
  // if nothing newer started after it: a refresh racing a write, or a read
  // from an unmounted (StrictMode) pass, is dropped instead of putting the box
  // back to a value the user just changed (delta review W1-24b, R-1/R-2).
  // Unmounting bumps it too, so nothing lands after the dialog is gone.
  const generationRef = useRef(0);
  const pendingRef = useRef(false);

  const reload = useCallback(() => {
    if (pendingRef.current) return;
    const mine = ++generationRef.current;
    void getOmniRouteKeySync()
      .then((next) => {
        if (generationRef.current !== mine) return;
        setEnabled(next);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generationRef.current === mine) setError(describeError(cause));
      });
  }, []);

  useEffect(() => {
    reload();
    return () => {
      generationRef.current += 1;
    };
  }, [reload]);

  const toggle = (next: boolean) => {
    if (pendingRef.current) return;
    const mine = ++generationRef.current;
    const previous = enabled;
    pendingRef.current = true;
    setEnabled(next);
    setPending(true);
    setError(null);
    void setOmniRouteKeySync(next)
      .catch((cause: unknown) => {
        if (generationRef.current !== mine) return;
        setEnabled(previous);
        setError(describeError(cause));
      })
      .finally(() => {
        pendingRef.current = false;
        if (generationRef.current === mine) setPending(false);
      });
  };

  return { enabled, usable: loaded && !pending, error, toggle, reload };
}

function ProviderRow({ provider, routed }: { provider: Provider; routed: AgentProfile[] }) {
  return (
    <li className="provider-row">
      <div className="provider-row-head">
        <span
          className={`provider-connection-dot${provider.connected ? " provider-connection-online" : ""}`}
          aria-hidden="true"
          title={provider.connected ? "Verbunden" : "Nicht verbunden"}
        />
        <span className="provider-name" title={provider.id}>
          {provider.name}
        </span>
        <span className={`badge badge-provider-kind badge-provider-kind-${provider.kind}`}>
          {providerKindLabel(provider.kind)}
        </span>
        <span
          className={`badge badge-provider-quota badge-provider-quota-${provider.quotaState}`}
        >
          {providerQuotaLabel(provider.quotaState)}
        </span>
        {routed.length > 0 ? (
          <span
            className="badge badge-routed"
            title={`Über OmniRoute geroutete Profile: ${routed
              .map((profile) => profile.id)
              .join(", ")}`}
          >
            via OmniRoute
          </span>
        ) : null}
      </div>

      {<ProviderDetail provider={provider} />}

      <ProviderUsageLine provider={provider} />

      {provider.kind === "api_key" || provider.id === OMNIROUTE_ID ? (
        <ProviderKeyControls providerId={provider.id} />
      ) : null}
    </li>
  );
}

function ProviderDetail({ provider }: { provider: Provider }) {
  const detail = providerDetailText(provider);
  if (detail === null) return null;
  return <div className="provider-detail">{detail}</div>;
}

/**
 * Renders the usage line under a provider row: a bar when a percentage is known,
 * a text fallback when only used/limit is known, a muted label for local
 * providers, and an em dash when the core reports nothing.
 */
function ProviderUsageLine({ provider }: { provider: Provider }) {
  const { usage } = provider;

  if (usage === null) {
    return (
      <div className="provider-usage" title="keine Usage-Quelle">
        <span className="provider-usage-empty">—</span>
      </div>
    );
  }

  if (usage.source === "local") {
    return (
      <div className="provider-usage">
        <span className="provider-usage-local">{usage.windowLabel}</span>
      </div>
    );
  }

  const stale = isUsageStale(usage);
  const title = stale ? `Stand: ${formatProviderObservedAt(usage.observedAt)}` : undefined;

  if (usage.percent !== null) {
    return (
      <div className={`provider-usage${stale ? " provider-usage-stale" : ""}`} title={title}>
        <span className="provider-usage-track">
          <span
            className={`provider-usage-fill ${providerUsageFillClass(usage.percent)}`}
            style={{ width: `${usage.percent}%` }}
          />
        </span>
        <span className="provider-usage-label">{usage.percent} %</span>
        <span className="provider-usage-window">{usage.windowLabel}</span>
        {usage.resetsAt !== null ? (
          <span className="provider-usage-reset">{formatProviderResetsAt(usage.resetsAt)}</span>
        ) : null}
      </div>
    );
  }

  if (usage.used !== null) {
    const text = usage.limit !== null ? `${usage.used} / ${usage.limit}` : usage.used;
    return (
      <div className={`provider-usage${stale ? " provider-usage-stale" : ""}`} title={title}>
        <span className="provider-usage-text">{text}</span>
        <span className="provider-usage-window">{usage.windowLabel}</span>
        {usage.resetsAt !== null ? (
          <span className="provider-usage-reset">{formatProviderResetsAt(usage.resetsAt)}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`provider-usage${stale ? " provider-usage-stale" : ""}`} title={title}>
      <span className="provider-usage-window">{usage.windowLabel}</span>
    </div>
  );
}

function ProviderKeyControls({ providerId }: { providerId: string }) {
  const { present, busy, error, save, remove, refresh } = useProviderKey(providerId);
  const [draft, setDraft] = useState("");

  const handleSave = () => {
    save(draft);
    setDraft("");
  };

  return (
    <div className="provider-key-controls">
      {present ? <span className="provider-key-present">Key hinterlegt</span> : null}
      {error ? <span className="provider-key-error" title={error}>{error}</span> : null}
      <div className="provider-key-row">
        <input
          type="password"
          className="field provider-key-input"
          aria-label="API-Key"
          autoComplete="current-password"
          placeholder={present ? "Neuen Key eingeben…" : "API-Key eingeben…"}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim() !== "") {
              event.preventDefault();
              handleSave();
            }
          }}
        />
        <button
          type="button"
          className="button-primary"
          onClick={handleSave}
          disabled={busy || draft.trim() === ""}
        >
          Speichern
        </button>
        <button
          type="button"
          className="button-ghost"
          onClick={remove}
          disabled={busy || !present}
        >
          Entfernen
        </button>
        <button
          type="button"
          className="button-ghost provider-key-refresh"
          onClick={refresh}
          disabled={busy}
          title="Erneut prüfen"
          aria-label="Erneut prüfen"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
