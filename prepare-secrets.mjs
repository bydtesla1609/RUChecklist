import {readFile, writeFile} from "node:fs/promises";
import {createHash,randomBytes} from "node:crypto";
const password = (await readFile(new URL("./data/access-code.txt", import.meta.url), "utf8")).trim();
if (!password) throw new Error("请先运行 node local.mjs 生成访问密码");
const destination = new URL("./data/deployment-secrets.json", import.meta.url);
let existing = {};
try { existing = JSON.parse(await readFile(destination, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await writeFile(destination, JSON.stringify({...existing, CLOUD_ENCRYPTION_KEY:existing.CLOUD_ENCRYPTION_KEY || randomBytes(32).toString("hex"), BOARD_PASSWORD_HASH: createHash("sha256").update(password).digest("hex")}), {mode: 0o600});
console.log("Deployment secrets prepared in data/deployment-secrets.json (excluded from Git).");
