BARAR SALAT TIME – UPDATE v1.3.0
================================

इस अपडेट में:
1) मौजूदा Email Login और पुराने users/login_events रिकॉर्ड सुरक्षित रखे गए हैं।
2) Mobile Number Login (+91, 10 अंक) जोड़ा गया है। अभी OTP नहीं है।
3) नई मस्जिद की Request में नाम, स्थायी Admin Email, पता, शहर और GPS अनिवार्य हैं।
4) मस्जिद की हर नई Request पहले PENDING रहेगी; Admin Approval के बाद ही Public Masjid बनेगी।
5) नाम+शहर और 100 मीटर GPS के आधार पर संभावित Duplicate दिखेंगे। अंतिम फैसला Admin करेगा।
6) हर Approved Masjid को Permanent Masjid ID मिलेगी।
7) Contact Us में नंबर दिखाए बिना WhatsApp चैट लिंक जोड़ी गई है: wa.me/918600178788

महत्वपूर्ण सुरक्षा नोट:
- बिना OTP वाला मोबाइल Login मोबाइल नंबर की मालिकी साबित नहीं करता। कोई अन्य व्यक्ति किसी नंबर को درج कर सकता है। अभी इसे verified identity, password recovery या मस्जिद admin permission के लिए इस्तेमाल न करें।
- Email Login भी अभी Email ownership verify नहीं करता।
- मस्जिद Admin Email केवल Request में रिकॉर्ड है; यह अपने आप उस Email के मालिक की पहचान प्रमाणित नहीं करता। मस्जिद में बदलाव का सुरक्षित अधिकार देने से पहले OTP/verification और role-based authorization जोड़ना होगा।
- GPS 100 मीटर के अंदर दूसरी अलग मस्जिद भी हो सकती है। इसलिए सिस्टम संभावित Duplicate को review में भेजता है; अपने आप किसी मस्जिद को delete/reject नहीं करता।
- ADMIN_TOKEN को APK, GitHub या सार्वजनिक जगह पर कभी न रखें। Cloudflare Worker Secret में ही रखें।

A. Cloudflare D1 पर नई Tables बनाना (पहले यही करें)
1. Cloudflare Dashboard > Workers & Pages > barar-salat-time-backend खोलें।
2. D1 database barar-salat-users खोलें > Console.
3. backend/schema_additive.sql की पूरी सामग्री Paste करके Run करें।
4. यह केवल नई tables बनाता है; users और login_events को नहीं हटाता।

B. Worker Update
1. Worker > Edit Code खोलें।
2. backend/worker.js की पूरी सामग्री से पुराना Worker code Replace करें।
3. Save and Deploy दबाएँ।
4. DB binding का नाम DB ही होना चाहिए। wrangler.toml में आपका मौजूदा Database ID पहले से भरा है।
5. Test: https://barar-salat-time-backend.perfectcomputerakl.workers.dev/api/health
   Response में ok:true और version:1.3.0 होना चाहिए।

C. Admin Secret
Cloudflare Worker > Settings > Variables and Secrets > Add > Secret:
Name: ADMIN_TOKEN
Value: अपना लंबा, random और private token बनाएं। इसे किसी को न भेजें।
अगर पहले से ADMIN_TOKEN Secret है तो नया बनाना जरूरी नहीं।

D. Android App Update
1. ZIP के अंदर app.zip नया Android source archive है।
2. GitHub repository perfectcomputerakl-arch/barar-salat-time खोलें।
3. Repository के root में मौजूदा app.zip को Replace करके इस package का app.zip Upload करें।
4. Commit changes करें।
5. GitHub Actions में Android build workflow खोलें और Run workflow करें (यदि workflow push पर खुद न चले)।
6. Build पूरा होने पर APK artifact डाउनलोड करें, Android फोन में Install करें।
7. Settings में Backend Worker URL यह रखें:
   https://barar-salat-time-backend.perfectcomputerakl.workers.dev

E. टेस्ट
- पुराना Email Login करके देखें; users और login_events पुराने records बने रहने चाहिए।
- Mobile Login में अपना 10 digit +91 नंबर डालें। D1 में mobile_users और mobile_login_events चेक करें।
- Add New Mosque में नाम, permanent admin email, address, city और GPS देकर Submit करें।
- D1 में masjid_submissions देखें; status pending होना चाहिए।
- Admin requests देखने के लिए GET /api/admin/masjid-requests और Header X-Admin-Token लगाएं।
- Approve/Reject के लिए POST /api/admin/masjid-decision; JSON उदाहरण:
  {"requestId":"REQUEST_UUID","decision":"approve"}
  Duplicate candidate आए तो पहले जांचें। सचमुच अलग मस्जिद हो तभी {"requestId":"REQUEST_UUID","decision":"approve","force":true} भेजें।
- Approved मस्जिद GET /api/masjids में दिखाई देगी।

API endpoints:
GET  /api/health
POST /api/login                 {"email":"person@example.com"}
POST /api/mobile-login          {"mobile":"+918765432109"}
POST /api/masjids/submit        {name,ownerEmail,address,city,pincode,phone,description,lat,lon}
GET  /api/masjids
GET  /api/admin/users           Header X-Admin-Token
GET  /api/admin/mobile-users    Header X-Admin-Token
GET  /api/admin/masjid-requests Header X-Admin-Token
POST /api/admin/masjid-decision Header X-Admin-Token

इस ZIP में Android Studio का पूरा project नहीं, बल्कि repository में डालने के लिए app.zip और backend update files शामिल हैं। APK GitHub Actions से build करना होगा।
