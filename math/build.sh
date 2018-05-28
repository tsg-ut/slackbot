#!/usr/bin/env bash

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <equation>" >&2
  exit 1
fi

input=$(echo "$1" | tr -d "\n ;")
output=$(maxima --batch-string="display2d:false;errormsg:false;errcatch($input);" --very-quiet -s | tail -n +6)

if [[ "$output" == incorrect* ]]; then
  echo "Syntax error" >&2
  exit 1
fi

result=$(echo "$output" | tail -n +2 | tr -d "\n ")

if [[ "$result" = "[]" ]]; then
  echo "Runtime error" >&2
  exit 1
fi

if [ "[$input]" = $result ]; then
  echo "Result is identical to the input" >&2
  exit 1
fi

if [[ $result == READ* ]]; then
  echo "Execution errored" >&2
  exit 1
fi

tex=$(maxima --batch-string="tex($input);" --very-quiet | tail -n +2 | head -n -1 | tr -d "\$\n")
outfile=$(mktemp)
bash ~/pnglatex -d 300 -o "$outfile" -f "$tex" -S

cat "$outfile"
