import {COMMUNITY_SCHEMA} from "./community.mjs";
// Bounded to 300 accounts across four databases, each below the free 500 MB limit.
export const TRIAL_SLOTS=300;
export function accountDatabase(env,slot){
  if(!Number.isInteger(slot)||slot<1||slot>TRIAL_SLOTS)throw new Error("Invalid account partition");
  const db=slot<=30?env.DB:slot<=120?env.STORE_A:slot<=210?env.STORE_B:env.STORE_C;
  if(!db)throw new Error("Account storage is not configured");return db;
}
export function partition(db,slot) {
  if(!Number.isInteger(slot) || slot<1 || slot>TRIAL_SLOTS)throw new Error("Invalid account partition");
  const prefix=`u${slot}_`;
  return {prepare(sql){
    // Rewrite only SQL identifiers; never strings or bound values. All SQL comes from our Worker.
    const scoped=sql.replace(/'(?:''|[^'])*'|\b(?:axes|tasks|sources|settings|files|file_chunks|sessions|login_attempts)\b/g,word=>word.startsWith("'")?word:prefix+word);
    return db.prepare(scoped);
  },batch(statements){return db.batch(statements);}};
}
export function trialSchema() {
  const sql=[`CREATE TABLE IF NOT EXISTS trial_users (id TEXT PRIMARY KEY,slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 300),username TEXT NOT NULL UNIQUE,auth_id TEXT UNIQUE,recovery_hash TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trial_users_status ON trial_users(status,slot);
CREATE TABLE IF NOT EXISTS trial_invites (hash TEXT PRIMARY KEY,slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 30),used_by TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS trial_sessions (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES trial_users(id),expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trial_sessions_user ON trial_sessions(user_id);
CREATE TABLE IF NOT EXISTS trial_collectors (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES trial_users(id));
CREATE TABLE IF NOT EXISTS trial_attempts (key TEXT PRIMARY KEY,count INTEGER NOT NULL,since INTEGER NOT NULL);`,COMMUNITY_SCHEMA];
  return sql.join("\n")+"\n"+accountStorageSchema();
}
export function accountStorageSchema(start=1,end=30){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end>TRIAL_SLOTS||start>end)throw new Error("Invalid storage range");
  const sql=[];
  for(let slot=start;slot<=end;slot++) {
    const p=`u${slot}_`;
    sql.push(`CREATE TABLE IF NOT EXISTS ${p}tasks (
id TEXT PRIMARY KEY,category TEXT NOT NULL CHECK(category IN ('作业','课程','考试','活动','会议','记录')),content TEXT NOT NULL,
due_at TEXT,starts_at TEXT,ends_at TEXT,status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
source TEXT,external_id TEXT,source_url TEXT,course TEXT NOT NULL DEFAULT '',overrides TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,updated_at TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',todos TEXT NOT NULL DEFAULT '[]',links TEXT NOT NULL DEFAULT '[]',attachments TEXT NOT NULL DEFAULT '[]',completed_at TEXT,source_status TEXT,details TEXT NOT NULL DEFAULT '{}',archived_at TEXT,archive_restored_at TEXT,axis_id TEXT,UNIQUE(source,external_id));
CREATE TABLE IF NOT EXISTS ${p}axes (id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',starts_at TEXT,ends_at TEXT,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ${p}axis ON ${p}tasks(axis_id,deleted);
CREATE INDEX IF NOT EXISTS ${p}visible ON ${p}tasks(deleted,created_at);
CREATE INDEX IF NOT EXISTS ${p}completed ON ${p}tasks(deleted,status,completed_at);
CREATE TABLE IF NOT EXISTS ${p}sources (id TEXT PRIMARY KEY,last_seen TEXT,task_count INTEGER NOT NULL DEFAULT 0,error TEXT);
INSERT OR IGNORE INTO ${p}sources(id) VALUES ('smartestu'),('ketangpai'),('chaoxing'),('ruc_courses'),('ruc_exams');
CREATE TABLE IF NOT EXISTS ${p}settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${p}files (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${p}file_chunks (file_id TEXT NOT NULL REFERENCES ${p}files(id) ON DELETE CASCADE,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(file_id,part));`);
  }
  return sql.join("\n");
}
