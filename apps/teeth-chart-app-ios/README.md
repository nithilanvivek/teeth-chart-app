# Teeth Chart App 1.0 for iPad

An offline iPad edition of the Python/Tkinter Tooth Chart Annotator. The native Swift app embeds the chart interface and keeps named charts plus edit history in private on-device storage as an offline fallback.

Tap **Choose Data Folder** to select any writable folder in Files or iCloud Drive. The app imports compatible chart files, migrates private charts into the selected folder, and automatically updates the current chart's JSON after every edit. The files survive app deletion and can be reopened by a newly sideloaded copy after selecting the same folder again.

The portable JSON schema matches the desktop app: `{ "chart_name": "…", "annotations": { … } }`. Import reads compatible JSON from Files and Export opens the native Files save sheet. Edit history remains private to each installation; the chart annotations are portable.

## Implementation and Installation

This is a native Swift `WKWebView` shell around bundled HTML, CSS, and JavaScript. The original desktop app remains Python/Tkinter, but the IPA contains no Python runtime and needs no server or internet connection.

The original Mac `.icns` was used only as source artwork. The iPad app uses an opaque PNG in `Assets.xcassets`; Xcode compiles the required iOS icon resources into the app package.

The finished IPA can be installed with Xcode's Devices and Simulators window, Apple Configurator, or Sideloadly. A sideloaded development build still requires Developer Mode on the iPad. When using a free Apple ID, re-sign or refresh the app before its seven-day profile expires.

## Build

Open `TeethChartApp.xcodeproj`, select the `TeethChartApp` scheme, choose an iPad simulator or connected iPad, and run. Physical-device builds use automatic signing with the selected Apple development team.

```sh
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
DEVICE_UDID=YOUR_IPAD_UDID \
./scripts/build-device-ipa.sh
```

The script creates the ignored device-specific `dist/ios/Teeth-Chart-App-1.0-dev.ipa`. Personal Team profiles expire after seven days.
