# Changelog

All notable changes to this project are documented in this file.

## 1.0.6 - 2026-04-28

### Changed
- Switched `host_permissions` to `optional_host_permissions` so host access is not requested at install time.
- Added a user-facing "Optional ZeroGPU features" toggle in the popup that requests/removes host permissions on demand.
- Updated background/offscreen startup flow to lazy-init the SDK only when the user explicitly enables it.
- Bumped extension version to `1.0.6`.

## 1.0.4 - 2026-04-18

### Changed
- `manifest.json` short description now states a **single** product: daily habit tracking **with optional habit-related AI** via ZeroGPU (addresses Chrome Web Store single-purpose review feedback).
- Popup header includes a short tagline so the in-extension UI matches the declared purpose.
- `store-listing.md`, `README.md`, and `privacy-policy.html` updated so listing text, single-purpose field, and privacy disclosures align (habit data local by default; optional AI may contact ZeroGPU when those features are used).

## 1.0.3 - 2026-04-17

### Added
- MV3 background service worker integration via `background.js`.
- Offscreen runtime files: `offscreen.html` and `offscreen.js`.
- Popup debug mode (`Ctrl+Shift+D`) to inspect SDK initialization status and force refresh.
- Local ONNX Runtime binaries:
  - `vendor/ort-wasm-simd.wasm`
  - `vendor/ort-wasm.wasm`

### Changed
- Updated `manifest.json` to version `1.0.3`.
- Added `offscreen` permission and host permissions for ZeroGPU endpoints.
- Added MV3 CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
- Updated packaging script `zip-for-store.sh` to include all runtime files required for Web Store submission.
- Updated `README.md` to reflect offscreen-based SDK architecture and debug workflow.
- Expanded `store-listing.md` privacy text for host/offscreen justifications and explicit remote-code explanation.

### Fixed
- Removed remotely hosted code paths and CDN runtime loading patterns that caused Chrome Web Store rejection.
- Ensured runtime dependencies are bundled locally for MV3 compliance.
