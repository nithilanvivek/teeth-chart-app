# Teeth Chart App

Open-source app editions by Nithilan Vivek. [Project website](https://nithi.land/projects/pyinstaller-teeth-chart-app/). MIT applies to original code/assets; see [LICENSE](LICENSE) and [third-party notices](THIRD-PARTY-NOTICES.md).

## Source editions

- `assets/downloads/teeth-chart-app/TeethChartApp.py`: v1 desktop source for Windows/macOS/Linux (Python standard library and Tkinter).
- `tools/teeth-chart/`: current browser edition, including local storage, JSON backups, authentication and cloud sharing.
- `supabase/`: permission-checked RPC/database migrations and email templates; `docs/` documents cloud setup.
- `apps/android/teeth-chart-app/`: offline mobile and ChromeOS WebView editions, with shared Android infrastructure.
- `apps/teeth-chart-app-ios/`: offline iOS WebView edition and build instructions.
- `apps/linux/`: legacy AppImage/DEB build script for this app only.

## Releases

Download packages from [GitHub Releases](https://github.com/nithilanvivek/teeth-chart-app/releases). Compiled packages are release attachments, not committed to source history. Checksums accompany downloads. Existing files are republished unchanged; publishing them does not add new platform testing or signing.

The downloadable desktop/mobile release is v1.0. The Microsoft Store upload package declares 1.0.0.0. The browser edition is a current source snapshot and is not the code contained in that older desktop MSIX. Existing iOS packages use device-specific development signing and are not attached as public installers.

## Browser setup and tests

Run `npm install`, configure your own Supabase URL and publishable key in `tools/teeth-chart/config.js`, and allowlist your local/deployed auth callback. Read the database setup and permission documentation under `docs/`, then apply migrations to your own project; service/SMTP secrets belong in server-side configuration or Supabase Vault. Do not apply these instructions to the author's production project. Start `npm run dev` and open `/tools/teeth-chart/`. The self-hosted edition preserves existing website-relative paths; deploy the repo root and configure callback/chart routes accordingly. `npm test` runs isolated mocked/PGlite tests without accessing production data.

For Google sign-in, create a Web application OAuth client in Google Cloud. Add your deployment origin (without a path) to Authorized JavaScript origins and your own Supabase project’s `https://YOUR_PROJECT.supabase.co/auth/v1/callback` to Authorized redirect URIs. Enable the Google provider in Supabase and enter the client ID and client secret there. Request only `openid`, `userinfo.email`, and `userinfo.profile` for sign-in. The app returns to `TeethConfig.authRedirect`, which must be allowlisted in Supabase. Keep the client secret out of browser files.

## Building mobile editions

See each platform README. Android builds require a suitable JDK, Android SDK and the bundled Gradle wrapper. Release signing uses externally supplied environment variables and your own key. No release keys or passwords are included. iOS builds require macOS/Xcode and your own signing configuration. Source layout is preserved so relative build paths remain valid.

## Contributing

Open issues and pull requests in this repository. Current app source lives here; nithi.land retains deployed copies and historical download URLs. Do not commit personal charts, autosaves, databases, credentials or signing material.
