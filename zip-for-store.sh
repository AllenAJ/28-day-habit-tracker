#!/bin/bash
# Build a lean ZIP for Chrome Web Store (only required files)
cd "$(dirname "$0")"
rm -f ../habit-tracker-extension.zip
zip ../habit-tracker-extension.zip \
  manifest.json \
  background.js \
  offscreen.html \
  offscreen.js \
  popup.html \
  popup.css \
  popup.js \
  vendor/zerogpu-browser-sdk.umd.js \
  vendor/transformers.min.js \
  vendor/ort-wasm-simd.wasm \
  vendor/ort-wasm.wasm \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png
echo "Created ../habit-tracker-extension.zip"
