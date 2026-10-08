# Teeth Chart App: legacy offline Android / ChromeOS editions

Source is under `teeth-chart-app/`; shared WebView code is under `common/`. Settings include only this app.

Install a compatible JDK and Android SDK, then from this directory run `./gradlew :teeth-chart-app:assembleMobileDebug :teeth-chart-app:assembleChromeosDebug` for local development. The flavors have separate app identities. Release builds require your own externally supplied signing environment variables; no private credentials are included.

The macOS helpers under `scripts/` use externally stored maintainer credentials. The public legacy APKs are non-debuggable and release-signed. Native Conway's newer testing edition is separate under `apps/conway-native/chromeos`.
