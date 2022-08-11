import regex

kr = regex.compile(r'^\p{Script=Han}$')

# 常用漢字表は
# https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/kijun/naikaku/pdf/joyokanjihyo_20101130.pdf
# より取得後、
# ./xpdf/xpdf-tools-linux-4.04/bin64/pdftotext -layout -nopgbrk -f 11 -l 161 -enc UTF-8 joyokanjihyo_20101130.pdf
# にてテキスト化。

def kanji():
	data = open("joyokanjihyo_20101130.txt","r").read()
	data = data.split('\n')[1:]
	res = []
	for d in data:
		# d = d.strip()
		if len(d) <= 0:
			continue
		if d[0] == ' ':
			d = d[1:]
		if len(d) <= 0:
			continue
		c = d[0]
		if kr.match(c) is not None:
			res.append(c)

	#res = list(sorted(res))
	tr = [res[0]]
	for i in range(len(res)-1):
		if res[i+1] not in tr:
			tr.append(res[i+1])
	res = tr

	return res

def debug(data):
	#return
	for c in data[:100]:
		print(c)
	print('=' * 30)
	for c in data[-100:]:
		print(c)

cs = kanji()
# debug(cs)

open('JoyoKanjis.txt',"w").write('\n'.join(cs))
