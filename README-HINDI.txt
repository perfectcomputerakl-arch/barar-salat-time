BARAR SALAT TIME - BACKEND SETUP

1) Cloudflare Dashboard > Workers & Pages > D1 SQL Database > Create database.
   Database name: barar-salat-users
2) Open the database > Console and run schema.sql.
3) Install Wrangler or use Cloudflare dashboard to create a Worker. Upload worker.js.
4) Bind D1 database to the Worker using variable name DB.
   In wrangler.toml replace database_id with your actual D1 ID.
5) Add Worker secret ADMIN_TOKEN (a long private value). Never put this token in the APK.
6) Deploy the Worker. Copy its URL, e.g. https://barar-salat-time-backend.<subdomain>.workers.dev
7) In the app Settings > Email Login, paste the Worker URL and enter email.

IMPORTANT: Login is EMAIL-ONLY as requested: no password and no OTP. Therefore email ownership is NOT verified. Anyone can type another person's email. The database records entered email addresses and login events, not verified identities. Do not use this as secure account authentication.

Admin list: GET https://YOUR-WORKER/api/admin/users with header X-Admin-Token: YOUR_ADMIN_TOKEN. Keep token private. You can also view users directly in D1 Console.

The app uses bundled Noto Nastaliq Urdu (OFL 1.1), an open Nastaliq-style font. It is not the proprietary Jameel Noori Nastaleeq font. If you own a licensed Jameel Noori Nastaleeq TTF/OTF, provide it and it can replace this font.

Ringtones: 3 included sounds are short soft notification tones, not recorded Adhan/Nasheed. User can add licensed audio files. This build saves app-level ringtone choices; actual background alarm scheduling and changing the phone's normal SIM-call ringtone require additional native Android integration and user/system permissions.
