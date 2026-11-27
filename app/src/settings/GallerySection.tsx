// Settings → Plugins & Gallery (PLAN-2 9.1, 9.3, brief §9):
// Manage installed sandboxed plugins (permission approval/revocation, removal), install from
// a local .opaline-plugin file, and browse the community gallery (fetched ONLY when explicitly
// requested while this panel is open — zero background requests).
import { useCallback, useEffect, useState } from "react";
import { Button } from "../design-system/components";
import {
  type GalleryIndex,
  type GalleryPackage,
  type PluginKind,
  type PluginStatus,
  approvePlugin,
  fetchGalleryIndex,
  installGalleryPackage,
  installPluginFile,
  listPlugins,
  removePlugin,
  revokePlugin,
} from "../shell/api";
import styles from "./Settings.module.css";

interface Props {
  notify: (msg: string) => void;
}

export function GallerySection({ notify }: Props) {
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);
  const [filePath, setFilePath] = useState("");
  const [gallery, setGallery] = useState<GalleryIndex | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | PluginKind>("all");

  const reload = useCallback(async () => {
    const items = await listPlugins();
    setPlugins(items);
  }, []);

  useEffect(() => {
    let alive = true;
    listPlugins()
      .then((items) => {
        if (alive) setPlugins(items);
      })
      .catch((e: unknown) => {
        if (alive) notify(`Could not list plugins: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const handleLoadGallery = () => {
    setGalleryBusy(true);
    void fetchGalleryIndex()
      .then((idx) => {
        setGallery(idx);
        notify(`Loaded ${String(idx.packages.length)} community packages`);
      })
      .catch((e: unknown) => {
        notify(`Gallery unavailable: ${String(e)}`);
      })
      .finally(() => {
        setGalleryBusy(false);
      });
  };

  const handleInstallFile = () => {
    const trimmed = filePath.trim();
    if (!trimmed) return;
    void installPluginFile(trimmed)
      .then(async (st) => {
        setFilePath("");
        await reload();
        notify(`Installed "${st.name}" — review and approve permissions below`);
      })
      .catch((e: unknown) => {
        notify(`Install failed: ${String(e)}`);
      });
  };

  const handleGalleryInstall = (pkg: GalleryPackage) => {
    void installGalleryPackage(pkg)
      .then(async (st) => {
        await reload();
        notify(`Verified & installed "${st.name}" — review permissions before enabling`);
      })
      .catch((e: unknown) => {
        notify(`Verification/install failed: ${String(e)}`);
      });
  };

  const filteredGallery = (gallery?.packages ?? []).filter(
    (p) => kindFilter === "all" || p.kind === kindFilter,
  );

  return (
    <>
      <div id="plugins-installed" className={styles.card}>
        <h2 className={styles.cardTitle}>Installed plugins &amp; permissions</h2>
        <p className={styles.cardDesc}>
          Code plugins run inside an isolated ADR 0014 Web Worker under{" "}
          <code>opaline-plugin://&lt;id&gt;/</code> with no network, no Tauri IPC, and a 2 s
          watchdog. Any change to permissions or code revokes approval automatically.
        </p>

        {plugins.length === 0 ? (
          <p className={styles.rowHint}>No plugins installed yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {plugins.map((p) => (
              <div key={p.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>
                    {p.name} v{p.pluginVersion} ({p.state})
                  </span>
                  <span className={styles.rowHint}>
                    {p.permissionSummary
                      ? p.permissionSummary
                      : (p.error ?? `${p.kind} by ${p.author}`)}
                  </span>
                </div>
                <div className={styles.inlineRow}>
                  {p.state === "needs-approval" ? (
                    <Button
                      variant="filled"
                      icon="check"
                      onClick={() => {
                        void approvePlugin(p.id)
                          .then(async () => {
                            await reload();
                            notify(`Approved plugin "${p.name}"`);
                          })
                          .catch((e: unknown) => {
                            notify(`Approval failed: ${String(e)}`);
                          });
                      }}
                    >
                      Approve
                    </Button>
                  ) : null}
                  {p.state === "approved" ? (
                    <Button
                      variant="tonal"
                      onClick={() => {
                        void revokePlugin(p.id)
                          .then(async () => {
                            await reload();
                            notify(`Revoked approval for "${p.name}"`);
                          })
                          .catch((e: unknown) => {
                            notify(`Revoke failed: ${String(e)}`);
                          });
                      }}
                    >
                      Revoke
                    </Button>
                  ) : null}
                  <Button
                    variant="text"
                    icon="delete"
                    onClick={() => {
                      void removePlugin(p.id)
                        .then(async () => {
                          await reload();
                          notify(`Removed plugin "${p.name}"`);
                        })
                        .catch((e: unknown) => {
                          notify(`Remove failed: ${String(e)}`);
                        });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="plugins-file" className={styles.card}>
        <h2 className={styles.cardTitle}>Install from package file</h2>
        <p className={styles.cardDesc}>
          Install a local <code>.opaline-plugin</code> archive created with{" "}
          <code>opaline pack &lt;dir&gt;</code>. Newly installed plugins remain inactive until you
          approve their permissions.
        </p>
        <div className={styles.inlineRow}>
          <input
            aria-label="Local plugin archive path"
            className={styles.input}
            style={{ flex: 1, minWidth: 220 }}
            placeholder="/path/to/my-widget-1.0.0.opaline-plugin"
            value={filePath}
            onChange={(e) => {
              setFilePath(e.target.value);
            }}
          />
          <Button variant="tonal" icon="add" onClick={handleInstallFile}>
            Install from file
          </Button>
        </div>
      </div>

      <div id="plugins-gallery" className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Community gallery</h2>
            <p className={styles.cardDesc}>
              Fetches the signed index only when you click Browse — no background traffic, no
              accounts, no telemetry. Every download checks SHA-256 and minisign Ed25519 signatures.
            </p>
          </div>
          <Button
            variant="filled"
            icon="refresh"
            disabled={galleryBusy}
            onClick={handleLoadGallery}
          >
            {gallery ? "Refresh gallery" : "Browse gallery"}
          </Button>
        </div>

        {gallery ? (
          <>
            <div className={styles.inlineRow} style={{ marginTop: 8, marginBottom: 10 }}>
              {(["all", "code-widget", "declarative-widget", "theme", "rice"] as const).map((k) => (
                <Button
                  key={k}
                  variant={kindFilter === k ? "tonal" : "text"}
                  onClick={() => {
                    setKindFilter(k);
                  }}
                >
                  {k === "all" ? "All" : k}
                </Button>
              ))}
            </div>
            {filteredGallery.length === 0 ? (
              <p className={styles.rowHint}>No packages match this filter.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredGallery.map((pkg) => {
                  const installed = plugins.find((p) => p.id === pkg.id);
                  const hasUpdate = installed && installed.pluginVersion !== pkg.version;
                  return (
                    <div key={pkg.id} className={styles.row}>
                      <div className={styles.rowText}>
                        <span className={styles.rowLabel}>
                          {pkg.name} v{pkg.version}
                        </span>
                        <span className={styles.rowHint}>
                          {pkg.description} · by {pkg.author} ({pkg.license})
                        </span>
                      </div>
                      <Button
                        variant={hasUpdate || !installed ? "filled" : "tonal"}
                        onClick={() => {
                          handleGalleryInstall(pkg);
                        }}
                      >
                        {hasUpdate ? "Update" : installed ? "Reinstall" : "Install"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
