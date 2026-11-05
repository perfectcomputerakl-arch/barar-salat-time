# BRAR SALAT TIME — Premium Home Interface Update

This Android Studio project contains the updated BRAR SALAT TIME home dashboard based on the latest reference image.

## Home screen design
- Deep navy / royal blue sky with a golden mosque scene.
- BRAR SALAT TIME title with menu and settings controls.
- Current Prayer / Next Prayer status.
- Awwal Waqt and Aakhir Waqt for the selected prayer.
- Electric-blue remaining-time / next-prayer countdown with an analog clock face and progress bar.
- Six Today's Details cards.
- Fixed bottom navigation with exactly four destinations: Nearby, Prayers, Qibla, Train.
- Train page has two premium buttons: Train Running Status (opens the official NTES mobile enquiry site) and IRCTC Website (opens IRCTC train search / booking). The old Indian Railways button has been removed.
- Home is the launch screen; it is intentionally not an extra fifth bottom-navigation button, matching the supplied reference.

## Open and build
1. Extract this ZIP.
2. Open the extracted `BRAR-SALAT-TIME` folder in Android Studio.
3. Allow Gradle sync to complete (Android Gradle Plugin 8.7.3; compile SDK 35).
4. Run on an Android device or build an APK from **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

## Train links
- Train Running Status: https://enquiry.indianrail.gov.in/mntes/ (official NTES live running enquiry).
- IRCTC Website: https://www.irctc.co.in/nget/train-search (official ticket search and booking).
- These buttons open the official websites; live train data is not embedded or independently fetched inside this app.

## Important
Prayer times require the app's location permission or a city selected in Settings. The countdown is calculated from the device's selected location and configured prayer calculation method; verify local mosque timetables for actual congregation times. This ZIP is the Android Studio source project, not a prebuilt APK.
