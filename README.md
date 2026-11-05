# BRAR SALAT TIME — Android Studio Source Project

This is the complete Android Studio project (Java + WebView) for BRAR SALAT TIME. The Android module is already expanded in `app/`; no nested archive extraction is needed.

## Included
- Home dashboard with current/next prayer, Awwal/Aakhir Waqt and countdown.
- Six daily timing cards.
- Sunrise Makrooh alert on Home: appears from calculated sunrise until 20 minutes after sunrise, then hides automatically while the app is open. It needs a selected GPS/manual location.
- Nearby page Locate button wired to the existing GPS location function. Mosque cards are currently sample/demo entries, not a live verified mosque directory.
- Prayers, Qibla compass (native rotation sensor bridge), and Train pages.
- Train Running Status opens official NTES; IRCTC opens official booking/search site.
- Urdu fonts and reminder audio assets.

## Open and build
1. Extract the ZIP.
2. In Android Studio choose **Open** and select the `BRAR-SALAT-TIME` folder (the folder containing `settings.gradle`).
3. Use JDK 17 and Android SDK Platform 35; allow Gradle sync. Android Gradle Plugin is 8.7.3.
4. Select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

## Important limitations
- This ZIP is source code, not a compiled APK. A local Android SDK/Gradle build is required.
- The Makrooh alert is an in-app visual alert while the app is running; background notification scheduling is not implemented by this change.
- Prayer times are calculated from the app's configured method/location; verify against the local masjid timetable.
- Nearby mosque entries and their listed times are demo/sample content. Live mosque discovery, directions and verified mosque records are not complete.
- Train pages open external official websites; train status is not fetched inside the app.
- Login/admin/cloud backend features depend on the configured Cloudflare Worker and database deployment.
