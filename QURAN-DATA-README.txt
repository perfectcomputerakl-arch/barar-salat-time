QURAN FEATURE - HOW TO ADD TEXT AND FONT
========================================
The Quran screen (surah list, juz, last read, bookmarks, reader, font size, Urdu translation toggle)
is built into the app. v1.7.13: Tanzil Simple text (v1.1, 6236 ayat) is bundled in quran-data.js. The Indo-Pak font and Urdu translation are still optional additions (until then the bundled Noto Nastaliq Urdu font is used).
Tanzil copyright notice: see TANZIL-QURAN-TEXT-NOTICE.txt (keep it with the project).

1) Text (Arabic)
   - Download "Quran text" from https://tanzil.net/download (plain text, pipe format: sura|aya|text).
   - Run:  python3 tools/make_quran_data.py quran-simple.txt quran-data.js QURAN_TEXT
   - Copy quran-data.js into app/src/main/assets/ (replace the stub).
   - Keep Tanzil's copyright / attribution notice (add it to About or Privacy/Terms page).

2) Urdu translation (optional, enables the "Urdu" button in the reader)
   - Download an Urdu translation from https://tanzil.net/trans/ (check its license).
   - Run:  python3 tools/make_quran_data.py ur.translation.txt quran-urdu.js QURAN_URDU
   - Copy quran-urdu.js into app/src/main/assets/.

3) Indo-Pak font
   - Add a Quran font in Indo-Pak (Nastaliq style) script as app/src/main/assets/fonts/QuranIndoPak.ttf
     (examples: Al Qalam Quran Majeed, PDMS Saleem QuranFont, Noor-e-Huda). CHECK THE FONT LICENSE before publishing.
   - Until then the app falls back to the bundled Noto Nastaliq Urdu font.

The script checks that every surah has the right number of ayat (total 6236) and stops with an error otherwise.
Always compare a few surahs with a printed mushaf before release.
