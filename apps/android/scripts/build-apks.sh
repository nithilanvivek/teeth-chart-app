#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
OUTPUT_DIR="$REPO_DIR/dist/android"

"$SCRIPT_DIR/build-signed-apks.sh"
cp "$OUTPUT_DIR/Teeth-Chart-App-1.0-signed.apk" "$OUTPUT_DIR/Teeth-Chart-App-1.0.apk"
cp "$OUTPUT_DIR/Teeth-Chart-App-1.0-ChromeOS-signed.apk" "$OUTPUT_DIR/Teeth-Chart-App-1.0-ChromeOS.apk"

(
    cd "$OUTPUT_DIR"
    shasum -a 256 \
        Teeth-Chart-App-1.0.apk \
        Teeth-Chart-App-1.0-ChromeOS.apk
        > SHA256SUMS.txt
)

echo "Built release-signed website APKs in $OUTPUT_DIR"
