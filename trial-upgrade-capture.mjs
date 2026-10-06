import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {TRIAL_SLOTS} from './trial-schema.mjs';
const migration=await readFile(new URL('./migrations/0008_capture.sql',import.meta.url),'utf8');
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/trial-upgrade-capture.sql',import.meta.url),Array.from({length:TRIAL_SLOTS},(_,i)=>migration.replace(/\b(tasks_next|tasks_visible|tasks_completed|tasks_schedule|tasks_axis|tasks|axes)\b/g,word=>`u${i+1}_${word}`)).join('\n'));
console.log('Generated dist/trial-upgrade-capture.sql; apply once before RUCapture 3.0.');
