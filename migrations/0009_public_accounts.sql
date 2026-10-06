PRAGMA defer_foreign_keys=ON;
CREATE TABLE trial_users_next (id TEXT PRIMARY KEY,slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 300),username TEXT NOT NULL UNIQUE,auth_id TEXT UNIQUE,recovery_hash TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
INSERT INTO trial_users_next SELECT * FROM trial_users;
DROP TABLE trial_users;
ALTER TABLE trial_users_next RENAME TO trial_users;
CREATE INDEX trial_users_status ON trial_users(status,slot);
PRAGMA defer_foreign_keys=OFF;
