#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/dist/linux}"
WORK_DIR="${WORK_DIR:-${OUTPUT_DIR}/work}"
APPIMAGETOOL="${APPIMAGETOOL:-appimagetool}"

case "$(uname -m)" in
  x86_64)
    FILE_ARCH="x86_64"
    DEB_ARCH="amd64"
    ;;
  aarch64|arm64)
    FILE_ARCH="arm64"
    DEB_ARCH="arm64"
    ;;
  *)
    echo "Unsupported Linux architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Linux packages must be built on Linux." >&2
  exit 1
fi

for command_name in python3 dpkg-deb "${APPIMAGETOOL}"; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

rm -rf "${WORK_DIR}"
mkdir -p "${OUTPUT_DIR}" "${WORK_DIR}"

write_app_run() {
  local path="$1"
  local app_id="$2"
  local binary_name="$3"

  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -e' \
    'APPDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'export LOCALAPPDATA="${LOCALAPPDATA:-${XDG_DATA_HOME:-${HOME}/.local/share}}"' \
    "exec \"\${APPDIR}/usr/lib/nithi-land/${app_id}/${binary_name}\" \"\$@\"" \
    > "${path}"
  chmod 0755 "${path}"
}

write_deb_launcher() {
  local path="$1"
  local app_id="$2"
  local binary_name="$3"

  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -e' \
    'export LOCALAPPDATA="${LOCALAPPDATA:-${XDG_DATA_HOME:-${HOME}/.local/share}}"' \
    "exec /opt/nithi-land/${app_id}/${binary_name} \"\$@\"" \
    > "${path}"
  chmod 0755 "${path}"
}

build_app() {
  local app_id="$1"
  local display_name="$2"
  local version="$3"
  local package_name="$4"
  local launcher_name="$5"
  local binary_name="$6"
  local source_path="$7"
  local desktop_path="$8"
  local icon_path="$9"
  local artifact_stem="${10}"
  local appimage_stem="${11}"

  local app_work="${WORK_DIR}/${app_id}"
  local pyinstaller_dist="${app_work}/pyinstaller-dist"
  local bundled_app="${pyinstaller_dist}/${binary_name}"
  local app_dir="${app_work}/${binary_name}.AppDir"
  local deb_root="${app_work}/deb-root"

  mkdir -p "${app_work}/pyinstaller-build" "${app_work}/spec"
  python3 -m PyInstaller \
    --noconfirm \
    --clean \
    --windowed \
    --onedir \
    --name "${binary_name}" \
    --distpath "${pyinstaller_dist}" \
    --workpath "${app_work}/pyinstaller-build" \
    --specpath "${app_work}/spec" \
    "${source_path}"

  test -x "${bundled_app}/${binary_name}"

  mkdir -p \
    "${app_dir}/usr/lib/nithi-land/${app_id}" \
    "${app_dir}/usr/bin" \
    "${app_dir}/usr/share/applications" \
    "${app_dir}/usr/share/icons/hicolor/512x512/apps"
  cp -a "${bundled_app}/." "${app_dir}/usr/lib/nithi-land/${app_id}/"
  ln -s "../lib/nithi-land/${app_id}/${binary_name}" "${app_dir}/usr/bin/${launcher_name}"
  install -m 0644 "${desktop_path}" "${app_dir}/usr/share/applications/${app_id}.desktop"
  install -m 0644 "${icon_path}" "${app_dir}/usr/share/icons/hicolor/512x512/apps/${app_id}.png"
  ln -s "usr/share/applications/${app_id}.desktop" "${app_dir}/${app_id}.desktop"
  ln -s "usr/share/icons/hicolor/512x512/apps/${app_id}.png" "${app_dir}/${app_id}.png"
  ln -s "${app_id}.png" "${app_dir}/.DirIcon"
  write_app_run "${app_dir}/AppRun" "${app_id}" "${binary_name}"

  ARCH="$(uname -m)" VERSION="${version}" "${APPIMAGETOOL}" "${app_dir}" "${OUTPUT_DIR}/${appimage_stem}-${FILE_ARCH}.AppImage"
  chmod 0755 "${OUTPUT_DIR}/${appimage_stem}-${FILE_ARCH}.AppImage"

  mkdir -p \
    "${deb_root}/DEBIAN" \
    "${deb_root}/opt/nithi-land/${app_id}" \
    "${deb_root}/usr/bin" \
    "${deb_root}/usr/share/applications" \
    "${deb_root}/usr/share/icons/hicolor/512x512/apps"
  cp -a "${bundled_app}/." "${deb_root}/opt/nithi-land/${app_id}/"
  write_deb_launcher "${deb_root}/usr/bin/${launcher_name}" "${app_id}" "${binary_name}"
  install -m 0644 "${desktop_path}" "${deb_root}/usr/share/applications/${app_id}.desktop"
  install -m 0644 "${icon_path}" "${deb_root}/usr/share/icons/hicolor/512x512/apps/${app_id}.png"
  cat > "${deb_root}/DEBIAN/control" <<CONTROL
Package: ${package_name}
Version: ${version}
Section: education
Priority: optional
Architecture: ${DEB_ARCH}
Maintainer: Nithilan Vivek <noreply@nithi.land>
Depends: libc6, libx11-6, libxext6, libxft2, libxrender1, libfontconfig1, libfreetype6, libxcb1, zlib1g
Description: ${display_name}
 A standalone offline Tkinter application published by nithi.land.
CONTROL
  find "${deb_root}" -type d -exec chmod 0755 {} +
  dpkg-deb --root-owner-group --build "${deb_root}" "${OUTPUT_DIR}/${artifact_stem}-${DEB_ARCH}.deb"
}

build_app \
  "land.nithi.teethchartapp" \
  "Teeth Chart App" \
  "1.0" \
  "nithi-land-teeth-chart-app" \
  "teeth-chart-app" \
  "TeethChartApp" \
  "${ROOT_DIR}/assets/downloads/teeth-chart-app/TeethChartApp.py" \
  "${ROOT_DIR}/apps/linux/desktop/land.nithi.teethchartapp.desktop" \
  "${ROOT_DIR}/apps/teeth-chart-app-ios/TeethChartApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png" \
  "Teeth-Chart-App-1.0" \
  "Teeth-Chart-App"

(
  cd "${OUTPUT_DIR}"
  sha256sum \
    ./*-"${FILE_ARCH}".AppImage \
    ./*-"${DEB_ARCH}".deb \
    > "SHA256SUMS-${FILE_ARCH}.txt"
)

echo "Linux packages written to ${OUTPUT_DIR}"
