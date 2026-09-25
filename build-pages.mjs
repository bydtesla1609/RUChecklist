import {mkdir,copyFile,writeFile} from "node:fs/promises";
const output=new URL("./dist/pages/",import.meta.url);
await mkdir(output,{recursive:true});
for(const name of ["index.html","app.js","style.css","icon.svg"]) await copyFile(new URL(`./static/${name}`,import.meta.url),new URL(name,output));
await copyFile(new URL("./worker.mjs",import.meta.url),new URL("_worker.js",output));
await writeFile(new URL("_routes.json",output),JSON.stringify({version:1,include:["/*"],exclude:[]}));
console.log("Pages package ready: dist/pages (four public assets, one server Worker).");
