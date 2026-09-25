CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('作业','科研','竞赛','活动','组织')),
  content TEXT NOT NULL,
  due_at TEXT, starts_at TEXT, ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  source TEXT, external_id TEXT, source_url TEXT, course TEXT NOT NULL DEFAULT '',
  overrides TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS tasks_visible ON tasks(deleted, created_at);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, last_seen TEXT, task_count INTEGER NOT NULL DEFAULT 0, error TEXT);
INSERT OR IGNORE INTO sources(id) VALUES ('smartestu'), ('ketangpai'), ('chaoxing');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, since INTEGER NOT NULL);
