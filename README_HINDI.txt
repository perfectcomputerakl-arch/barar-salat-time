BARAR SALAT TIME — Android Studio Project
=========================================

यह Android Studio में खोलने योग्य source project है। यह अभी तैयार APK फाइल नहीं है।

APK बनाने के लिए:
1. Windows कंप्यूटर पर Android Studio इंस्टॉल करें।
2. ZIP extract करें।
3. Android Studio > Open चुनें और BARAR_SALAT_TIME_Android फ़ोल्डर खोलें।
4. Gradle Sync पूरा होने दें और Android SDK Platform 35 इंस्टॉल करने को कहे तो इंस्टॉल करें।
5. Build > Build Bundle(s) / APK(s) > Build APK(s) चुनें।
6. APK सामान्यतः app/build/outputs/apk/debug/app-debug.apk में बनेगा।
7. फोन में APK भेजकर install करें। फोन में “Install unknown apps” अनुमति माँगी जा सकती है।

इस पैकेज में मौजूदा HTML ऐप को Android WebView में चलाने की व्यवस्था, स्थानीय WAV टोन, ऐप आइकन,
लोकेशन अनुमति और फाइल चुनने की सुविधा जोड़ी गई है।

महत्वपूर्ण — अभी क्या पूरा नहीं है:
- यह Android Studio source project है; इस वातावरण में Android SDK/Gradle उपलब्ध न होने के कारण APK compile नहीं किया गया।
- मौजूदा Awwal/Aakhir नमाज़ समय अभी demo placeholders हैं। वास्तविक Hanafi + Karachi calculation engine अभी जोड़ना बाकी है।
- Jamaat time अभी डिवाइस के browser storage में सेव होता है; यह फोन-विशिष्ट है, cloud sync नहीं है।
- Background alarms/notifications, native call ringtone बदलना, वास्तविक compass/Qibla sensor और live mosque maps अभी production-ready नहीं हैं।
- Notification permission manifest में रखी है, लेकिन अभी scheduled prayer notifications लागू नहीं हैं।

Package name: com.barar.salattime
App name: BARAR SALAT TIME
Version: 1.0.0
