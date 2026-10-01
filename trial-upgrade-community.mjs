// Existing trial databases only. Fresh installs use trialSchema().
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {COMMUNITY_SCHEMA} from './community.mjs';
import {TRIAL_SLOTS} from './trial-schema.mjs';
const archive=await readFile(new URL('./migrations/0006_manual_archive.sql',import.meta.url),'utf8');
export const communityUpgrade=()=>[...Array.from({length:TRIAL_SLOTS},(_,i)=>archive.replace(/\btasks_archive\b/g,`u${i+1}_tasks_archive`).replace(/\btasks\b/g,`u${i+1}_tasks`)),COMMUNITY_SCHEMA].join('\n');
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/trial-upgrade-community.sql',import.meta.url),communityUpgrade());
console.log('Generated dist/trial-upgrade-community.sql. Apply once to an existing trial database before deploying v2.14.0.');
