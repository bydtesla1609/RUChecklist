import {mkdir,copyFile,writeFile,readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {trialSchema} from "./trial-schema.mjs";
execFileSync("python",["-X","utf8",fileURLToPath(new URL("./package-extension.py",import.meta.url))],{stdio:"inherit"});
const publicSite=process.argv.includes("--public"),trial=publicSite || process.argv.includes("--trial"),folder=publicSite?"public":trial?"trial":"pages",output=new URL(`./dist/${folder}/`,import.meta.url);
await mkdir(output,{recursive:true});
for(const name of ["index.html","app.js","capture.js","axis-layout.js","messages.js","style.css","icon.svg","extension.zip"]) await copyFile(new URL(`./static/${name}`,import.meta.url),new URL(name,output));
await copyFile(new URL(trial?"./trial-worker.mjs":"./worker.mjs",import.meta.url),new URL("_worker.js",output));
if(trial) {
  for(const name of ["worker.mjs","trial-schema.mjs","community.mjs"])await copyFile(new URL(`./${name}`,import.meta.url),new URL(name,output));
  await mkdir(new URL("static/",output),{recursive:true});
  for(const name of ["app.js","capture.js","axis-layout.js","messages.js","style.css","icon.svg"])await copyFile(new URL(`./static/${name}`,import.meta.url),new URL(`static/${name}`,output));
  await writeFile(new URL("./dist/trial-schema.sql",import.meta.url),trialSchema());
  const config=JSON.parse(await readFile(new URL(publicSite?"./wrangler.public.jsonc":"./wrangler.trial.jsonc",import.meta.url),"utf8").catch(()=>readFile(new URL("./wrangler.trial.example.jsonc",import.meta.url),"utf8")));
  config.pages_build_output_dir=`../${folder}`;
  const deploy=new URL(`./dist/${folder}-deploy/`,import.meta.url);await mkdir(deploy,{recursive:true});await writeFile(new URL("wrangler.jsonc",deploy),JSON.stringify(config,null,2));
}
await copyFile(new URL("./cloud.mjs",import.meta.url),new URL("cloud.mjs",output));
await mkdir(new URL("extension/",output),{recursive:true});
for(const name of ["parsers.js","cloud-routes.js","academic-parser.js","ruc-adapters.js"]) await copyFile(new URL(`./extension/${name}`,import.meta.url),new URL(`extension/${name}`,output));
await writeFile(new URL("_routes.json",output),JSON.stringify({version:1,include:["/*"],exclude:trial?["/","/static/app.js","/static/capture.js","/static/axis-layout.js","/static/messages.js","/static/style.css","/static/icon.svg","/extension.zip"]:[]}));
console.log(`Pages package ready: dist/${folder}.`);
