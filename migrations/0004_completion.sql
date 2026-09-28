ALTER TABLE tasks ADD COLUMN completed_at TEXT;
ALTER TABLE tasks ADD COLUMN source_status TEXT;
UPDATE tasks SET completed_at=updated_at WHERE status='done';
CREATE INDEX IF NOT EXISTS tasks_completed ON tasks(deleted,status,completed_at);
