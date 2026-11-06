#!/bin/bash
# Maple IPTV for Mac: builds the app on this Mac (Apple Silicon or Intel),
# signs it for this Mac, installs it in Applications and opens it.
# Double-click this file, or run:  bash "Build Maple IPTV.command"
# It needs the internet the first time (Node.js and Electron, about 200 MB).
set -euo pipefail
cd "$(dirname "$0")"

NODE_VERSION="v22.12.0"
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  *) ARCH=x64 ;;
esac
TOOLS="$HOME/Library/Caches/MapleIPTV-build"
NODE_DIR="$TOOLS/node-$NODE_VERSION-darwin-$ARCH"

echo ""
echo "=== Maple IPTV for Mac ($ARCH) ==="
echo ""

if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "1/5  Downloading Node.js $NODE_VERSION (only used to build the app)..."
  mkdir -p "$TOOLS"
  curl -fL --progress-bar "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$ARCH.tar.gz" | tar -xz -C "$TOOLS"
else
  echo "1/5  Node.js is already here."
fi
export PATH="$NODE_DIR/bin:$PATH"

cd desktop
echo "2/5  Installing the build tools..."
npm install --no-fund --no-audit --loglevel=error

echo "3/5  Building the app (a few minutes)..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir "--$ARCH"
APP="$(ls -d ../dist/desktop/mac*/"Maple IPTV.app" | head -n 1)"

echo "4/5  Signing it for this Mac..."
codesign --force --deep --sign - "$APP"

echo "5/5  Installing in Applications..."
rm -rf "/Applications/Maple IPTV.app"
ditto "$APP" "/Applications/Maple IPTV.app"
xattr -cr "/Applications/Maple IPTV.app" 2>/dev/null || true

echo ""
echo "Done! Maple IPTV is in your Applications folder. Opening it now..."
open "/Applications/Maple IPTV.app"
