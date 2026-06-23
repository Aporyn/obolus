#!/usr/bin/env bash
# Build Obolus.app from the SwiftPM executable (no Xcode required — uses `swift build`).
#
# Usage:
#   ./build-app.sh                            # build the .app; backend resolved at runtime (env/npx)
#   ./build-app.sh --bundle-runtime           # also embed node + the obolus CLI dist into the .app
#   ./build-app.sh --bundle-runtime --install # build, then clean-install to /Applications + relaunch
#
# The bundled-runtime form is self-contained: it runs even if the user has no global obolus.
# --install does a *clean* replace (removes the old bundle first) so a stale bundled dist can never
# survive a partial overwrite — the failure mode where a new binary meets an old serve.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
APP="$HERE/Obolus.app"
INSTALL_DEST="/Applications/Obolus.app"
CONFIG=release
BUNDLE_RUNTIME=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --bundle-runtime) BUNDLE_RUNTIME=1 ;;
    --install) INSTALL=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

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

if [[ "$INSTALL" == "1" ]]; then
  echo "› installing to $INSTALL_DEST"
  # Quit any running instance (the app + its embedded serve) so files release and `open` can't
  # just re-foreground a stale process. Matches "Obolus.app" only — leaves a global `obolus`
  # CLI serve untouched.
  if pkill -f "Obolus.app" 2>/dev/null; then
    echo "  quit running Obolus"
    sleep 1
  fi
  # Clean replace — remove the old bundle entirely, then copy fresh (no merge leftovers).
  rm -rf "$INSTALL_DEST"
  ditto "$APP" "$INSTALL_DEST"
  echo "  installed → $INSTALL_DEST"
  open "$INSTALL_DEST" && echo "  relaunched"
else
  echo "  run: open '$APP'   (or, for dev with the workspace build:)"
  echo "  OBOLUS_NODE=\$(which node) OBOLUS_DIST='$REPO_ROOT/dist' '$APP/Contents/MacOS/Obolus'"
fi
