# Contributing to the Opaline Community Gallery

The Opaline Community Gallery (`ali-kenjo/opaline-gallery`) is a static GitHub repository containing a signed `index.json` and curated `.opaline-plugin`, `.opaline-theme`, and `.opaline-rice` packages. Opaline fetches the index **only while the user explicitly browses the Gallery** — no accounts, no telemetry, and every install verifies SHA-256 + minisign Ed25519 signatures.

## Submitting a Package (Pull Request)

1. Build and validate your package locally:
   ```bash
   opaline validate ./my-package
   opaline pack ./my-package -o packages/my-package-1.0.0.opaline-plugin
   ```
2. Add an entry to `index.json` (leave `signature` blank on initial PR — the gallery maintainer signs verified PRs with the gallery minisign key on merge).
3. Ensure your package meets all security requirements:
   - OSI-approved license declared in `plugin.json`.
   - Zero obfuscated/minified-only code without readable source in the PR.
   - Zero remote URLs in CSS or assets.
   - Minimal permissions (only the exact topics and actions your widget uses).
4. Run the gallery CI check locally before opening your PR:
   ```bash
   ./scripts/validate-gallery-pr.sh ./my-package
   ```

## Maintainer Signing Flow

After reviewing a PR:
```bash
minisign -Sm packages/my-package-1.0.0.opaline-plugin -s ~/.minisign/opaline-gallery.key
sha256sum packages/my-package-1.0.0.opaline-plugin
```
Embed the resulting SHA-256 hex and `.minisig` contents into `index.json` and merge to `main`.
