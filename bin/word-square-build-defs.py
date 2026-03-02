import argparse
import json
import os
import re
import sqlite3
import sys
from typing import Iterable, List, Set


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description='Build word-square definitions SQLite database.')
	parser.add_argument(
		'--stages',
		default='word-square/stages.sqlite3',
		help='Stages SQLite path. Default: word-square/stages.sqlite3',
	)
	parser.add_argument(
		'--lexicon',
		required=True,
		help='Source lexicon SQLite path. Example: ./CSW24.db',
	)
	parser.add_argument(
		'--output',
		default='word-square/definitions.sqlite3',
		help='Output SQLite path. Default: word-square/definitions.sqlite3',
	)
	parser.add_argument(
		'--reset',
		action='store_true',
		help='Delete output DB if it exists before writing.',
	)
	parser.add_argument(
		'--batch-size',
		type=int,
		default=900,
		help='Number of words per IN() query. Default: 900',
	)
	return parser.parse_args()


def iter_stage_words(conn: sqlite3.Connection) -> Iterable[str]:
	cursor = conn.cursor()
	cursor.execute('SELECT rows, cols FROM stages')
	while True:
		rows = cursor.fetchmany(1000)
		if not rows:
			break
		for rows_json, cols_json in rows:
			for word in json.loads(rows_json):
				yield word
			for word in json.loads(cols_json):
				yield word


def chunked(items: List[str], size: int) -> Iterable[List[str]]:
	for i in range(0, len(items), size):
		yield items[i:i + size]


def censor_definition(definition: str) -> str:
	return re.sub(r'(?<!-)\b[A-Z]{2,}\b', lambda m: '?' * len(m.group()), definition)


def main() -> int:
	args = parse_args()
	stages_path = os.path.expanduser(args.stages)
	lexicon_path = os.path.expanduser(args.lexicon)
	out_path = os.path.expanduser(args.output)
	batch_size = max(1, args.batch_size)

	if args.reset and os.path.exists(out_path):
		os.remove(out_path)

	os.makedirs(os.path.dirname(out_path), exist_ok=True)

	stages_conn = sqlite3.connect(stages_path)
	try:
		words: Set[str] = set()
		for word in iter_stage_words(stages_conn):
			if word:
				words.add(word.upper())
	finally:
		stages_conn.close()

	if not words:
		print('No words found in stages database. Nothing to do.')
		return 1

	lex_conn = sqlite3.connect(lexicon_path)
	out_conn = sqlite3.connect(out_path)
	out_conn.execute('PRAGMA journal_mode=OFF')
	out_conn.execute('PRAGMA synchronous=OFF')
	out_conn.execute(
		'CREATE TABLE IF NOT EXISTS definitions ('
		'word TEXT PRIMARY KEY,'
		'definition TEXT NOT NULL,'
		'definition_censored TEXT NOT NULL,'
		'probability_order INTEGER'
		')'
	)

	insert_sql = (
		'INSERT OR REPLACE INTO definitions'
		' (word, definition, definition_censored, probability_order)'
		' VALUES (?, ?, ?, ?)'
	)

	found_total = 0
	missing_total = 0
	out_conn.execute('BEGIN')
	try:
		cur = lex_conn.cursor()
		for chunk in chunked(sorted(words), batch_size):
			placeholders = ','.join('?' for _ in chunk)
			query = (
				f'SELECT word, definition, probability_order0'
				f' FROM words WHERE word IN ({placeholders})'
			)
			cur.execute(query, chunk)
			rows = cur.fetchall()
			if rows:
				out_rows = [
					(word, defn, censor_definition(defn), prob)
					for word, defn, prob in rows
				]
				out_conn.executemany(insert_sql, out_rows)
				found_words = {row[0] for row in rows}
				found_total += len(found_words)
				missing_total += len(chunk) - len(found_words)
			else:
				missing_total += len(chunk)
		out_conn.commit()
	finally:
		lex_conn.close()
		out_conn.close()

	print(f'Unique stage words: {len(words)}')
	print(f'Found definitions: {found_total}')
	print(f'Missing definitions: {missing_total}')
	return 0


if __name__ == '__main__':
	sys.exit(main())
