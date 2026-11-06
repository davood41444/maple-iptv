# Building Maple IPTV

The interface is plain HTML, CSS and JavaScript in `web/`, with no build step. Each platform wraps it in a small native app:

| Folder | Platform | Player |
|---|---|---|
| `android/` | Android TV, Google TV, phones and tablets | ExoPlayer |
| `tizen/` | Samsung TV | Samsung AVPlay |
| `desktop/` | Windows, Mac and Linux (Electron) | Chromium, with subtitles read from the file |
| `ios/` | iPhone and iPad | VLC (MobileVLCKit) |

## Try it in a browser

```bash
node tools/dev-server.js
```

Open http://localhost:8080. Arrow keys work like a remote: Enter is OK, and Esc or Backspace is Back. A sample playlist is at http://localhost:8080/sample.m3u.

## Android

```bash
cd android
./gradlew assembleDebug
```

The file is `android/app/build/outputs/apk/debug/app-debug.apk`. To install it on a TV over the network, turn on Developer options and USB (or wireless) debugging on the TV, then run:

```bash
adb connect <tv-ip>:5555
adb install -r app-debug.apk
```

## Windows, Mac and Linux

```bash
cd desktop
npm install
npm start               # run from source
npm run dist:win        # Windows installer, in dist/desktop
npm run dist:mac        # Mac app (on a Mac)
npm run dist:linux      # .deb and AppImage (on Linux)
```

## Samsung TV

Samsung TVs only install apps signed with a Samsung certificate made for those TVs. Follow these steps:

1. **Install Tizen Studio:** include **TV Extensions** and **Samsung Certificate Extension**.
2. **Turn on Developer mode on the TV:** open Apps, press 1 2 3 4 5, then enter this computer's IP.
3. **Make a Samsung certificate:** in Certificate Manager, with the TV connected.
4. **Build, sign and install:**

```bash
node tools/build-tizen.js
tizen package -t wgt -s <certificate-profile> -- build/tizen
tizen install -n <file>.wgt -t <tv-name> -- build/tizen
```

## iPhone and iPad

There's no Mac needed: GitHub builds the app on a cloud Mac. The workflow is `.github/workflows/ios.yml`, which runs XcodeGen, CocoaPods and an unsigned build, then checks the result. Run it from **Actions → iPhone app**.

To ship through TestFlight and the App Store you need an Apple Developer account:

1. **Create the app:** in App Store Connect, use the bundle ID `com.mapleonlinesolutions.iptv`.
2. **Create an API key:** in Users and Access → Integrations, with the App Manager role.
3. **Add the repository secrets:** `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the .p8 file's text) and `APPLE_TEAM_ID`.
4. **Upload:** run **iPhone app** with **testflight** ticked.

## Releasing a new version

1. **Set the version** in these files:
   - `desktop/package.json`
   - `android/app/build.gradle.kts` (`versionName`, and raise `versionCode`)
   - `tizen/config.xml`
   - `ios/project.yml` (`MARKETING_VERSION`)
2. **Push a tag:**

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

   The **Release** workflow creates the GitHub release. It builds the Windows, Mac and Linux apps, starts each one once to check it opens, and attaches them.
3. **Attach the Android file:** build `app-debug.apk` and add it to the release as `MapleIPTV.apk`.

The website's download buttons always point to the latest release.

## Free mode

The apps are free for now: `FREE` in `web/js/premium.js`. Setting it to `false` brings back the 7-day trial and Premium (Google Play, App Store or a code from the website).

## Adding a language

1. **Translate the texts:** copy `web/js/locales/en.js` (for example to `de.js`) and translate it.
2. **Load the file:** add it to `web/index.html`.
3. **List the language:** add it to `languages` in `web/js/i18n.js`. Right-to-left languages need `dir: 'rtl'`.
