import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {TRIAL_SLOTS} from './trial-schema.mjs';
const migration=await readFile(new URL('./migrations/0007_auto_archive.sql',import.meta.url),'utf8');
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/trial-upgrade-archive.sql',import.meta.url),Array.from({length:TRIAL_SLOTS},(_,i)=>migration.replace(/\btasks\b/g,`u${i+1}_tasks`)).join('\n'));
console.log('Generated dist/trial-upgrade-archive.sql. Apply once to an existing v2.14 trial database before deploying v2.15.');
