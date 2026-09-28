CREATE TABLE tasks_next (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('作业','课程','考试','活动','会议')),
  content TEXT NOT NULL,
  due_at TEXT, starts_at TEXT, ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  source TEXT, external_id TEXT, source_url TEXT, course TEXT NOT NULL DEFAULT '',
  overrides TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
  todos TEXT NOT NULL DEFAULT '[]', links TEXT NOT NULL DEFAULT '[]', attachments TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT, source_status TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source, external_id)
);
INSERT INTO tasks_next(id,category,content,due_at,starts_at,ends_at,status,source,external_id,source_url,course,overrides,revision,deleted,created_at,updated_at,title,location,todos,links,attachments,completed_at,source_status)
SELECT id,CASE WHEN category IN ('科研','竞赛','组织') THEN '活动' ELSE category END,content,due_at,starts_at,ends_at,status,source,external_id,source_url,course,overrides,
  revision+CASE WHEN category IN ('科研','竞赛','组织') THEN 1 ELSE 0 END,deleted,created_at,updated_at,title,location,todos,links,attachments,completed_at,source_status FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_next RENAME TO tasks;
CREATE INDEX tasks_visible ON tasks(deleted,created_at);
CREATE INDEX tasks_completed ON tasks(deleted,status,completed_at);
CREATE INDEX tasks_schedule ON tasks(deleted,category,starts_at);
INSERT OR IGNORE INTO sources(id) VALUES ('ruc_courses'),('ruc_exams');
