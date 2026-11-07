# BARAR SALAT TIME — Android Studio / GitHub Source (v1.4.1)

This is an update to the existing `perfectcomputerakl-arch/barar-salat-time` project. It is not a replacement app.

## Home layout
Top-right menu only → six solar-time cards → current prayer/countdown → five prayer cards → Hadith → five bottom navigation buttons. The emerald-green/gold theme, embedded Urdu Nastaliq font and supplied logo are retained.

## Prayer rules
- Manual Jamaat times; blank until configured in Settings.
- Khatm Saher = Fajr start.
- Ishraq = sunrise + 20 minutes.
- Chasht = Ishraq + 2 hours 30 minutes.
- Iftar and Maghrib Awwal = sunset + 3 minutes.
- Sunrise Makrooh alert = sunrise to +20 minutes.
- Zawal alert = 5 minutes before to 5 minutes after calculated solar noon.
- Countdown runs during each Awwal-to-Akhir interval; Isha is handled over midnight until Fajr.

## Nearby Masjid
No fake/sample listings are displayed. GPS opens a real Google Maps search for mosques near the current location. Choose a mosque in Maps and tap Directions.

## GitHub upload
Upload/replace the extracted project contents in the root of the existing repository: https://github.com/perfectcomputerakl-arch/barar-salat-time . Keep `.github/workflows/android-build.yml`, root `app/`, and root `app.zip` together. Commit to `main`, then open GitHub Actions and download `BARAR-SALAT-TIME-debug-apk` if the workflow succeeds.

## Verification / limitations
JavaScript syntax and ZIP structure were checked. This package has not been built into an APK in this environment and has not been tested on a physical phone. Notifications are currently checked while the WebView is running; exact alarms after force-stop/app closure or reboot are not guaranteed. GPS, compass, notifications and Maps handoff require device testing. Check prayer times against your trusted local timetable.
