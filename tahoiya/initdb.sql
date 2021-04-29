create table themes(
  user TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  ruby TEXT NOT NULL,
  meaning TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  ts INTEGER,
  done INTEGER
);
