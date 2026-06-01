#!/usr/bin/env bash
# Build gym-app from source and install on the connected iPhone over USB.
# RUN THIS IN Terminal.app (NOT the VSCode terminal). Quit VSCode first, or
# reboot — the build needs ~1.1GB free during "transforming…", which VSCode +
# the Claude extension (~3GB) eat up on this 8GB machine.
#
#   ./scripts/device-build.sh                 # uses the saved UDID
#   ./scripts/device-build.sh <UDID>          # override device
#
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Connected iPhone UDID (Leonel Llorens's iPhone, iOS 26.4.2). Override via $1.
UDID="${1:-00008140-00141DA03E13801C}"

cd "$(dirname "$0")/.."   # → gym-app/

echo "▶ 1/6  Building web assets…"
CAPACITOR_BUILD=true npm run build

echo "▶ 2/6  cap sync ios…"
npx cap sync ios

echo "▶ 3/6  pod install…"
( cd ios/App && pod install )

echo "▶ 4/6  Cleaning stale build dir + DerivedData…"
chmod -R u+w ios/App/build 2>/dev/null || true
rm -rf ios/App/build
rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug clean

echo "▶ 5/6  Compiling for device…"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath ios/App/build \
  -allowProvisioningUpdates build

echo "▶ 6/6  Installing on device ${UDID}…"
xcrun devicectl device install app --device "${UDID}" \
  ios/App/build/Build/Products/Debug-iphoneos/App.app

echo "✅ Done. App installed on the iPhone."
