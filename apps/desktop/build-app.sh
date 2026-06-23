#!/usr/bin/env bash
# Build Obolus.app from the SwiftPM executable (no Xcode required — uses `swift build`).
#
# Usage:
#   ./build-app.sh                 # build the .app; backend resolved at runtime (env/npx)
#   ./build-app.sh --bundle-runtime  # also embed node + the obolus CLI dist into the .app
#
# The bundled-runtime form is self-contained: it runs even if the user has no global obolus.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
APP="$HERE/Obolus.app"
CONFIG=release
BUNDLE_RUNTIME=0
[[ "${1:-}" == "--bundle-runtime" ]] && BUNDLE_RUNTIME=1

echo "› swift build -c $CONFIG"
( cd "$HERE" && swift build -c "$CONFIG" )
BIN="$HERE/.build/$CONFIG/Obolus"

echo "› assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Obolus"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.obolus.desktop</string>
  <key>CFBundleName</key><string>Obolus</string>
  <key>CFBundleDisplayName</key><string>Obolus</string>
  <key>CFBundleExecutable</key><string>Obolus</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

if [[ "$BUNDLE_RUNTIME" == "1" ]]; then
  echo "› bundling node + obolus dist into Resources"
  ( cd "$REPO_ROOT" && pnpm build )
  mkdir -p "$APP/Contents/Resources/obolus"
  cp -R "$REPO_ROOT/dist" "$APP/Contents/Resources/obolus/dist"
  NODE_BIN="$(command -v node)"
  cp "$NODE_BIN" "$APP/Contents/Resources/node"
  echo "  embedded node=$NODE_BIN and obolus/dist"
fi

echo "› done: $APP"
echo "  run: open '$APP'   (or, for dev with the workspace build:)"
echo "  OBOLUS_NODE=\$(which node) OBOLUS_DIST='$REPO_ROOT/dist' '$APP/Contents/MacOS/Obolus'"
