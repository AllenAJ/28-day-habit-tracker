## 28 Days Habit Tracker Chrome Extension

This is a **daily habit tracker** for Chrome with **optional habit-related AI** via the bundled ZeroGPU Browser SDK (same product: habits first; AI only supports that experience). Habit data is stored in `chrome.storage.sync`, so your habits can sync across Chrome profiles where sync is enabled.

### Features

- Add simple text habits (e.g. "Drink water", "Read 10 minutes").
- Check off habits for **today** with a tap.
- See **current streak** in days for each habit.
- Quick stats for how many habits are done today.
- Reset all of today's checkmarks with one click.

### How to load in Chrome

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this `Habit tracker Extension` folder.
5. Click the extension icon in the toolbar to open the habit tracker popup.

### ZeroGPU SDK integration

The extension initializes the ZeroGPU Browser SDK in an offscreen document so ML/runtime code can run in a DOM-capable context under MV3. This supports **optional habit-related AI** features, not a separate unrelated product.

Notes:
- SDK state is managed by the service worker and offscreen page (`background.js` + `offscreen.js`).
- Bundled runtime assets are local under `vendor/` (no remotely hosted scripts).
- ONNX Runtime WASM binaries are packaged locally (`vendor/ort-wasm-simd.wasm`, `vendor/ort-wasm.wasm`).
- A hidden debug panel is available in the popup with `Ctrl+Shift+D` to inspect SDK init status.

### Chrome Web Store: single purpose

The listing and privacy copy describe **one** purpose: habit tracking **including** optional habit-related AI via ZeroGPU. Keep `manifest.json` `description`, store **Single purpose**, and `privacy-policy.html` aligned when you ship updates.

