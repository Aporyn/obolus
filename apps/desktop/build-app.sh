#!/usr/bin/env bash
# Build Obolus.app from the SwiftPM executable (no Xcode required — uses `swift build`).
#
# Usage:
#   ./build-app.sh                            # build the .app; backend resolved at runtime (env/npx)
#   ./build-app.sh --bundle-runtime           # also embed node + the obolus CLI dist into the .app
#   ./build-app.sh --bundle-runtime --install # build, then clean-install to /Applications + relaunch
#   ./build-app.sh --dmg                       # build a self-contained, distributable .dmg
#
# The bundled-runtime form is self-contained: it runs even if the user has no global obolus.
# --install does a *clean* replace (removes the old bundle first) so a stale bundled dist can never
# survive a partial overwrite — the failure mode where a new binary meets an old serve.
# --dmg implies --bundle-runtime and produces an ad-hoc-signed, *unsigned-for-Gatekeeper* disk image
# for the host architecture. With no Apple Developer ID it can't be notarized — the recipient must
# clear quarantine (`xattr -cr /Applications/Obolus.app`) on first launch.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
APP="$HERE/Obolus.app"
INSTALL_DEST="/Applications/Obolus.app"
CONFIG=release
BUNDLE_RUNTIME=0
INSTALL=0
DMG=0
for arg in "$@"; do
  case "$arg" in
    --bundle-runtime) BUNDLE_RUNTIME=1 ;;
    --install) INSTALL=1 ;;
    --dmg) DMG=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
# A distributable image must be self-contained — the recipient may have no node/obolus installed.
[[ "$DMG" == "1" ]] && BUNDLE_RUNTIME=1
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
ARCH="$(uname -m)"

echo "› swift build -c $CONFIG"
( cd "$HERE" && swift build -c "$CONFIG" )
BIN="$HERE/.build/$CONFIG/Obolus"

echo "› assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Obolus"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.obolus.desktop</string>
  <key>CFBundleName</key><string>Obolus</string>
  <key>CFBundleDisplayName</key><string>Obolus</string>
  <key>CFBundleExecutable</key><string>Obolus</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
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

if [[ "$DMG" == "1" ]]; then
  DMG_PATH="$HERE/Obolus-$VERSION-$ARCH.dmg"
  echo "› packaging $DMG_PATH"
  # Ad-hoc sign so the bundle is internally consistent (avoids "app is damaged"); this is NOT a
  # Developer ID signature, so Gatekeeper still treats it as unidentified — the recipient clears
  # quarantine on first launch.
  if codesign --force --deep --sign - "$APP" >/dev/null 2>&1; then
    echo "  ad-hoc signed"
  else
    echo "  (ad-hoc sign skipped)"
  fi
  # Stage the .app beside a drag-target symlink to /Applications, then build a compressed image.
  STAGE="$(mktemp -d)"
  ditto "$APP" "$STAGE/Obolus.app"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$DMG_PATH"
  hdiutil create -volname "Obolus $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$STAGE"
  echo "  built: $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1)) · $ARCH only · unsigned"
  echo "  recipient: drag Obolus → Applications, then: xattr -cr /Applications/Obolus.app"
fi

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
fi

if [[ "$INSTALL" != "1" && "$DMG" != "1" ]]; then
  echo "  run: open '$APP'   (or, for dev with the workspace build:)"
  echo "  OBOLUS_NODE=\$(which node) OBOLUS_DIST='$REPO_ROOT/dist' '$APP/Contents/MacOS/Obolus'"
fi
