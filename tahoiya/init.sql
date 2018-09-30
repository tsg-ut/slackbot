create table themes (
	user text not null,
	word text not null,
	ruby text not null unique,
	meaning text not null,
	source text not null,
	url text not null,
	ts integer not null,
	done integer not null
);
