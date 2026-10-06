import {mkdir,writeFile} from 'node:fs/promises';
import {accountStorageSchema} from './trial-schema.mjs';
await mkdir('dist',{recursive:true});
for(const [name,start,end] of [['a',31,120],['b',121,210],['c',211,300]]){
  await writeFile(`dist/public-store-${name}.sql`,accountStorageSchema(start,end));
}
console.log('Prepared schemas for public account storage; no remote changes applied.');
