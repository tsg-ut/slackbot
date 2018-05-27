if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <equation>" >&2
  exit 1
fi

input=$(echo "$1" | tr -d "\n ;")
result=$(maxima --batch-string="display2d:false;$input;" --very-quiet -s | tail -n +5 | tr -d "\n ")

if [ $input = $result ]; then
  echo "Result is identical to the input"
  exit 1
fi

tex=$(maxima --batch-string="tex($input);" --very-quiet | tail -n +2 | head -n -1 | tr -d "\$\n")
outfile=$(mktemp)
bash ~/pnglatex -d 300 -o "$outfile" -f "$tex" -S

cat "$outfile"
