ALTER TABLE tasks ADD COLUMN archived_at TEXT;
UPDATE tasks SET archived_at=completed_at WHERE category<>'课程' AND status='done' AND datetime(completed_at)<=datetime('now','-7 days');
CREATE INDEX tasks_archive ON tasks(deleted,archived_at);
