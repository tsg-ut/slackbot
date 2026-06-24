import argparse
import glob
import json
import os
import re
import sqlite3
import sys
from typing import Iterable, List

ROW_RE = re.compile(r'^[A-Z]{7}$')
SOLUTION_RE = re.compile(r'^Solution\s+#\d+:$')


def iter_input_files(patterns: List[str]) -> Iterable[str]:
	for pattern in patterns:
		expanded = os.path.expanduser(pattern)
		for path in sorted(glob.glob(expanded)):
			yield path


def compute_cols(rows: List[str]) -> List[str]:
	return [''.join(row[i] for row in rows) for i in range(7)]


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description='Build word-square stages SQLite database.')
	parser.add_argument(
		'--input',
		nargs='+',
		required=True,
		help='Input log glob(s). Example: ./*.log',
	)
	parser.add_argument(
		'--output',
		default='word-square/stages.sqlite3',
		help='Output SQLite path. Default: word-square/stages.sqlite3',
	)
	parser.add_argument(
		'--commit-every',
		type=int,
		default=1000,
		help='Commit every N inserts. Default: 1000',
	)
	parser.add_argument(
		'--max-boards',
		type=int,
		default=0,
		help='Stop after inserting N boards (0 means no limit).',
	)
	parser.add_argument(
		'--reset',
		action='store_true',
		help='Delete output DB if it exists before writing.',
	)
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	out_path = os.path.expanduser(args.output)

	if args.reset and os.path.exists(out_path):
		os.remove(out_path)

	os.makedirs(os.path.dirname(out_path), exist_ok=True)
	conn = sqlite3.connect(out_path)
	conn.execute('PRAGMA journal_mode=OFF')
	conn.execute('PRAGMA synchronous=OFF')
	conn.execute(
		'CREATE TABLE IF NOT EXISTS stages ('
		'id INTEGER PRIMARY KEY,'
		'board TEXT NOT NULL UNIQUE,'
		'rows TEXT NOT NULL,'
		'cols TEXT NOT NULL,'
		'unique_words INTEGER NOT NULL,'
		'is_symmetric INTEGER NOT NULL'
		')'
	)
	conn.execute('CREATE INDEX IF NOT EXISTS stages_board_idx ON stages(board)')
	conn.execute('CREATE INDEX IF NOT EXISTS stages_is_symmetric_idx ON stages(is_symmetric)')
	insert_sql = 'INSERT OR IGNORE INTO stages (board, rows, cols, unique_words, is_symmetric) VALUES (?, ?, ?, ?, ?)'

	inserted = 0
	dupes = 0
	total_solutions = 0
	commit_every = max(1, args.commit_every)

	conn.execute('BEGIN')
	try:
		paths = list(iter_input_files(args.input))
		if not paths:
			print('No input files matched. Please pass --input with a valid glob.')
			return 1
		for path in paths:
			collecting = False
			rows: List[str] = []
			with open(path, 'r', encoding='utf-8', errors='replace') as handle:
				for raw_line in handle:
					line = raw_line.strip()
					if not line:
						continue
					if SOLUTION_RE.match(line):
						collecting = True
						rows = []
						continue
					if not collecting:
						continue
					if ROW_RE.match(line):
						rows.append(line)
						if len(rows) == 7:
							board = ''.join(rows)
							cols = compute_cols(rows)
							unique_words = len(set(rows + cols))
							is_symmetric = int(rows == cols)
							before = conn.total_changes
							conn.execute(insert_sql, (board, json.dumps(rows), json.dumps(cols), unique_words, is_symmetric))
							total_solutions += 1
							if conn.total_changes > before:
								inserted += 1
							else:
								dupes += 1
							if inserted % commit_every == 0:
								conn.commit()
								conn.execute('BEGIN')
							if args.max_boards and inserted >= args.max_boards:
								raise StopIteration
							collecting = False
							rows = []
						continue
					# Unexpected line inside a solution block. Reset.
					collecting = False
					rows = []
	except StopIteration:
		pass
	finally:
		conn.commit()
		conn.close()

	print(f'Parsed solutions: {total_solutions}')
	print(f'Inserted boards: {inserted}')
	print(f'Duplicates skipped: {dupes}')
	return 0


if __name__ == '__main__':
	sys.exit(main())
