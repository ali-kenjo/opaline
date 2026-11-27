// Settings → Accounts & integrations (PLAN-2 6.5, 6.8):
// Manages named secrets stored exclusively in the GNOME Keyring (`org.freedesktop.secrets`)
// and lists first-party integration endpoints (n8n, MQTT, GitHub, Home Assistant, Feeds, EDS).
import { useCallback, useEffect, useState } from "react";
import { Button } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { deleteSecret, listSecrets, setSecret } from "../shell/api";
import styles from "./Settings.module.css";

const INTEGRATIONS = [
  {
    id: "n8n",
    name: "n8n (local or remote)",
    desc: "Store your n8n API key in GNOME Keyring (e.g. n8n_key) and reference {{secret:n8n_key}} in an HTTP/JSON source with local HTTP opt-in.",
    phase: "Ready via Data sources · Dedicated widget in P7",
  },
  {
    id: "mqtt",
    name: "MQTT Broker",
    desc: "Store broker credentials in GNOME Keyring and subscribe to live topics over TLS or loopback.",
    phase: "Ready via Data sources · Dedicated widget in P7",
  },
  {
    id: "github",
    name: "GitHub",
    desc: "Fine-grained personal access token in GNOME Keyring for notifications, PRs, issues, and Actions.",
    phase: "Dedicated widget in P7",
  },
  {
    id: "home-assistant",
    name: "Home Assistant",
    desc: "Long-lived access token in GNOME Keyring for REST + WebSocket entity states and controls.",
    phase: "Dedicated widget in P7",
  },
  {
    id: "eds",
    name: "GNOME Online Accounts / EDS",
    desc: "Uses your system Evolution Data Server calendars and tasks automatically with zero extra tokens.",
    phase: "Calendar active · Tasks widget in P7",
  },
] as const;

export function AccountsSection({ notify }: { notify: (msg: string) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await listSecrets();
      setNames(list);
    } catch (e) {
      notify(`GNOME Keyring unavailable: ${String(e)}`);
    }
  }, [notify]);

  useEffect(() => {
    let alive = true;
    listSecrets()
      .then((list) => {
        if (alive) setNames(list);
      })
      .catch((e: unknown) => {
        if (alive) notify(`GNOME Keyring unavailable: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const handleStore = async () => {
    const clean = secretName.trim();
    if (!clean || !secretValue) {
      notify("Enter both a secret name and value");
      return;
    }
    setBusy(true);
    try {
      await setSecret(clean, secretValue);
      setSecretName("");
      setSecretValue("");
      await reload();
      notify(`Stored "${clean}" in GNOME Keyring`);
    } catch (e) {
      notify(`Could not store secret: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="accounts-keyring">
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <Icon name="lock" size={18} /> GNOME Keyring secrets
        </h3>
        <p className={styles.cardDesc}>
          API keys and tokens live only in your GNOME Keyring (<code>org.freedesktop.secrets</code>)
          and are never written to JSON files, backups, logs, or diagnostics. Reference them in HTTP
          headers as <code>{"{{secret:<name>}}"}</code>.
        </p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Secret name</span>
          <input
            aria-label="Secret name"
            className={styles.input}
            placeholder="e.g. n8n_key"
            value={secretName}
            onChange={(e) => {
              setSecretName(e.target.value);
            }}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Secret value</span>
          <input
            aria-label="Secret value"
            type="password"
            autoComplete="new-password"
            className={styles.input}
            placeholder="Paste token or API key"
            value={secretValue}
            onChange={(e) => {
              setSecretValue(e.target.value);
            }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Button
            variant="filled"
            icon="lock"
            disabled={busy}
            onClick={() => {
              void handleStore();
            }}
          >
            Save to GNOME Keyring
          </Button>
        </div>

        <div style={{ marginTop: 14 }}>
          {names.length === 0 ? (
            <p className={styles.cardDesc}>No Opaline secrets stored in GNOME Keyring yet.</p>
          ) : (
            names.map((n) => (
              <div key={n} className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowLabel}>
                    <code>{n}</code>
                  </div>
                  <div className={styles.rowHelp}>
                    Placeholder: <code>{`{{secret:${n}}}`}</code> · Value hidden
                  </div>
                </div>
                <Button
                  variant="text"
                  icon="delete"
                  aria-label={`Delete secret ${n}`}
                  onClick={() => {
                    void deleteSecret(n)
                      .then(async () => {
                        await reload();
                        notify(`Deleted secret "${n}"`);
                      })
                      .catch((e: unknown) => {
                        notify(`Could not delete secret: ${String(e)}`);
                      });
                  }}
                >
                  Delete
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.card} id="accounts-integrations">
        <h3 className={styles.cardTitle}>Integrations</h3>
        <p className={styles.cardDesc}>
          Every integration is opt-in and routes all network requests through Opaline core.
        </p>
        {INTEGRATIONS.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{item.name}</div>
              <div className={styles.rowHelp}>{item.desc}</div>
            </div>
            <span className={styles.rowHelp}>{item.phase}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
