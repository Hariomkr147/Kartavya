"""Pure business rules. The most important package in the codebase.

Everything here is a function over plain values — ints, strings, enums,
datetimes. No SQLAlchemy, no Flask, no `datetime.now()`: the current time is
always passed in as an argument.

That purity is not stylistic. These rules need hundreds of tests (every legal
transition, every illegal one, every band boundary), and pure functions make
those tests run in milliseconds with no fixtures. The moment a rule needs a
database session, testing it becomes slow and awkward and it stops being tested
thoroughly.

`.importlinter` enforces this mechanically. Adding `from app.extensions import db`
to any module in here is a failing build, by design.
"""
