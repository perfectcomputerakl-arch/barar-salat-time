#!/usr/bin/env python3
"""Convert a Tanzil-format text file (sura|aya|text per line) into quran-data.js / quran-urdu.js.

Usage:
  python3 make_quran_data.py quran-simple.txt  quran-data.js   QURAN_TEXT
  python3 make_quran_data.py ur.jalandhry.txt  quran-urdu.js   QURAN_URDU

Download the files from https://tanzil.net/download (Quran text) and
https://tanzil.net/trans/ (translations). Keep their copyright/attribution notice.
Then copy the generated .js files into app/src/main/assets/ (replace the stubs).
"""
import sys, json
COUNTS=[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6]
def main(src,dst,var):
    data={}
    for line in open(src,encoding='utf-8'):
        line=line.rstrip('\n')
        if not line.strip() or line.startswith('#'): continue
        p=line.split('|',2)
        if len(p)!=3: continue
        s,a,t=int(p[0]),int(p[1]),p[2].strip()
        data.setdefault(s,{})[a]=t
    out={}
    for s in range(1,115):
        ayat=data.get(s,{})
        if set(ayat)!=set(range(1,COUNTS[s-1]+1)):
            sys.exit(f'Surah {s}: expected ayat 1..{COUNTS[s-1]}, found {len(ayat)} (check numbering)')
        out[str(s)]=[ayat[i] for i in range(1,COUNTS[s-1]+1)]
    open(dst,'w',encoding='utf-8').write('window.'+var+'='+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n')
    print('OK:',dst,sum(COUNTS),'ayat')
if __name__=='__main__':
    if len(sys.argv)!=4: sys.exit(__doc__)
    main(*sys.argv[1:])
