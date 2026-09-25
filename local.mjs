import {DatabaseSync} from "node:sqlite";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join,dirname,resolve} from "node:path";
import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
import worker, {digest} from "./worker.mjs";

const root=dirname(fileURLToPath(import.meta.url));
export function sqliteBinding(database) {
  const wrap=(sql,args=[])=>({
    bind(...params){return wrap(sql,params.map(value=>value instanceof ArrayBuffer ? new Uint8Array(value) : value));},
    async first(){return database.prepare(sql).get(...args) || null;},
    async all(){return {results:database.prepare(sql).all(...args)};},
    async run(){const result=database.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};},
    _sql:sql,_args:args
  });
  return {prepare:wrap,async batch(statements){
    database.exec("BEGIN");
    try {
      const results=statements.map(s=>{
        const statement=database.prepare(s._sql);
        if(statement.columns().length) return {results:statement.all(...s._args),meta:{changes:0}};
        const result=statement.run(...s._args);return {results:[],meta:{changes:Number(result.changes)}};
      });
      database.exec("COMMIT");return results;
    } catch(error){database.exec("ROLLBACK");throw error;}
  }};
}
export async function createEnvironment(dataDir, password) {
  await mkdir(dataDir,{recursive:true});
  const database=new DatabaseSync(join(dataDir,"board.sqlite3"));
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  database.exec(await readFile(join(root,"schema.sql"),"utf8"));
  if(!database.prepare("PRAGMA table_info(tasks)").all().some(column=>column.name==="title")) {
    database.exec("BEGIN");
    try { database.exec(await readFile(join(root,"migrations/0002_task_details.sql"),"utf8")); database.exec("COMMIT"); }
    catch(error) { database.exec("ROLLBACK"); database.close(); throw error; }
  }
  if(!database.prepare("PRAGMA table_info(tasks)").all().some(column=>column.name==="links")) {
    database.exec("BEGIN");
    try { database.exec(await readFile(join(root,"migrations/0003_resources.sql"),"utf8")); database.exec("COMMIT"); }
    catch(error) { database.exec("ROLLBACK"); database.close(); throw error; }
  }
  const keyFile=join(dataDir,"access-code.txt");
  let key=password;
  if(!key){try{key=(await readFile(keyFile,"utf8")).trim();}catch{key=randomBytes(18).toString("base64url");await writeFile(keyFile,key,{mode:0o600});}}
  const env={DB:sqliteBinding(database),BOARD_PASSWORD_HASH:await digest(key),ASSETS:{async fetch(request){
    const pathname=new URL(request.url).pathname;
    const name=pathname==="/" ? "index.html" : pathname.slice(1);
    if(!["index.html","app.js","style.css","icon.svg"].includes(name)) return new Response("Not found",{status:404});
    const mime={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",svg:"image/svg+xml"};
    return new Response(await readFile(join(root,"static",name)),{headers:{"Content-Type":mime[name.split(".").pop()]}});
  }}};
  return {env,database};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const {env}=await createEnvironment(process.env.BOARD_DATA || join(root,"data"),process.env.BOARD_PASSWORD);
  const server=createServer(async(req,res)=>{
    try {
      const url=`http://${req.headers.host || "127.0.0.1"}${req.url}`;
      const request=new Request(url,{method:req.method,headers:req.headers,...(!["GET","HEAD"].includes(req.method)?{body:req,duplex:"half"}:{})});
      const result=await worker.fetch(request,env);
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
    } catch {res.writeHead(500);res.end("Request failed");}
  });
  const port=Number(process.env.PORT || 8765), host=process.env.BOARD_HOST || "127.0.0.1";
  server.listen(port,host,()=>console.log(`Campus Board: http://${host}:${port}\nAccess code is stored in data/access-code.txt`));
}
