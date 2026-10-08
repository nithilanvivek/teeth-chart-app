#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$PROJECT_DIR/../.." && pwd)
OUTPUT_DIR="$REPO_DIR/dist/android"
CURRENT_ACCOUNT=$(id -un)
CURRENT_ACCOUNT_HOME=$(dscl . -read "/Users/$CURRENT_ACCOUNT" NFSHomeDirectory | awk '{print $2}')

if [ -z "${ANDROID_HOME:-}" ]; then
    ANDROID_HOME="$CURRENT_ACCOUNT_HOME/Library/Android/sdk"
fi

export ANDROID_HOME

if [ -z "${NITHI_ANDROID_KEYSTORE:-}" ]; then
    NITHI_ANDROID_KEYSTORE="$CURRENT_ACCOUNT_HOME/.android/release-keys/nithi-land-release.p12"
fi

if [ -z "${NITHI_ANDROID_STORE_PASSWORD:-}" ]; then
    NITHI_ANDROID_STORE_PASSWORD=$(security find-generic-password \
        -a nithi.land \
        -s land.nithi.android-release \
        -w)
fi

NITHI_ANDROID_KEY_PASSWORD=${NITHI_ANDROID_KEY_PASSWORD:-$NITHI_ANDROID_STORE_PASSWORD}
NITHI_ANDROID_KEY_ALIAS=${NITHI_ANDROID_KEY_ALIAS:-nithi-land-release}

export NITHI_ANDROID_KEYSTORE
export NITHI_ANDROID_STORE_PASSWORD
export NITHI_ANDROID_KEY_PASSWORD
export NITHI_ANDROID_KEY_ALIAS

cd "$PROJECT_DIR"
./gradlew \
    :teeth-chart-app:assembleMobileRelease \
    :teeth-chart-app:assembleChromeosRelease
mkdir -p "$OUTPUT_DIR"
cp teeth-chart-app/build/outputs/apk/mobile/release/teeth-chart-app-mobile-release.apk \
    "$OUTPUT_DIR/Teeth-Chart-App-1.0-signed.apk"
cp teeth-chart-app/build/outputs/apk/chromeos/release/teeth-chart-app-chromeos-release.apk \
    "$OUTPUT_DIR/Teeth-Chart-App-1.0-ChromeOS-signed.apk"

(
    cd "$OUTPUT_DIR"
    shasum -a 256 \
        Teeth-Chart-App-1.0-signed.apk \
        Teeth-Chart-App-1.0-ChromeOS-signed.apk
        > SHA256SUMS-signed.txt
)

unset NITHI_ANDROID_STORE_PASSWORD
unset NITHI_ANDROID_KEY_PASSWORD

echo "Built APKMirror-ready APKs in $OUTPUT_DIR"
