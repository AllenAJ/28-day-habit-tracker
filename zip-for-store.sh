#!/bin/bash
# Build a lean ZIP for Chrome Web Store (only required files)
cd "$(dirname "$0")"
rm -f ../habit-tracker-extension.zip
zip ../habit-tracker-extension.zip \
  manifest.json \
  popup.html \
  popup.css \
  popup.js \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png
echo "Created ../habit-tracker-extension.zip"
