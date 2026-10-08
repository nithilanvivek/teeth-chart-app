# Linux desktop apps

This directory packages this app's legacy Python/Tkinter desktop edition for Linux as:

- portable AppImages for x86_64 and ARM64;
- installable Debian packages for amd64 and arm64.

The packages are built on matching Linux architectures because PyInstaller does
not cross-compile application bundles from macOS. Run the `Build Linux apps`
GitHub Actions workflow manually. Each architecture job uploads its packages and
a SHA-256 checksum file as a workflow artifact.

## Local Linux build

Install Python 3, Tkinter, PyInstaller, `dpkg-deb`, and an architecture-matching
`appimagetool`. Then run:

```sh
APPIMAGETOOL=/path/to/appimagetool \
  apps/linux/scripts/build-packages.sh
```

Outputs are written to the ignored `dist/linux/` directory. Copy verified public
release files into `assets/downloads/linux-apps/` only after testing them on Linux.
The build keeps AppImage filenames versionless and writes the release version into
the AppImage metadata so automated catalogs can monitor one permanent direct URL.

## Linux testing

For each architecture:

1. Run the AppImage after `chmod +x`.
2. Install the DEB with `sudo apt install ./filename.deb` and launch them from
   the desktop app menu.
3. Verify save, close, reopen, import, and export behavior.
4. Uninstall each DEB and confirm user-created data remains intact.
