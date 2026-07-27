# Migrations

Alembic, from the first commit — even though `schema.dbml` is already final.

`db.create_all()` is fine for tests. It is **not** fine for the shared dev
database: SQLite's `ALTER TABLE` support is very limited, and two of the things
this schema needs cannot be expressed declaratively at all (see below).

## Generating the first migration

```bash
cd backend
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
flask --app app seed
```

`env.py` reads the database URL from the Flask config, so Alembic and the app
can never disagree about which file they are pointed at.

## Two things to check by hand in that first revision

Autogenerate gets most of the schema right and these two wrong:

1. **The catch-all zone index must be PARTIAL.** It must come out as

   ```sql
   CREATE UNIQUE INDEX ux_zones_catch_all ON zones (is_catch_all)
       WHERE is_catch_all = 1;
   ```

   A plain unique index would also cap the table at one `is_catch_all = false`
   row, blocking every real zone after the first. `Zone.__table_args__` declares
   it with `sqlite_where`, but confirm the generated SQL actually carries the
   `WHERE` clause.

2. **The enum CHECK constraints.** Every enum column is
   `Enum(..., native_enum=False)`, which should render as a `CHECK (col IN
   (...))`. If a column comes out as a bare `VARCHAR`, a typo'd status becomes
   storable and the schema's central integrity guarantee is gone.

## Writing later migrations

`render_as_batch=True` is already set in `env.py`. SQLite cannot alter a column
or drop a constraint in place, so Alembic rebuilds the table instead — without
batch mode, a large share of the migrations you would ever write simply fail.
