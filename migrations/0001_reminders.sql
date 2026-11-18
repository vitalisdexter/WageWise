CREATE TABLE IF NOT EXISTS reminders (
  device TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  schedule TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  last_date TEXT,
  last_test INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reminders_due ON reminders (due_at);
