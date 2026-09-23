import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
const env={};
for(const name of ['.neo4j.env','.app.env']){
  const file=path.join(ROOT,name);if(!existsSync(file))continue;
  for(const line of readFileSync(file,'utf8').split('\n')){if(!line.trim()||line.startsWith('#'))continue;const split=line.indexOf('=');if(split>0)env[line.slice(0,split).trim()]=line.slice(split+1).trim();}
}
Object.assign(env,process.env);
export const config={port:Number(env.APP_PORT||4310),neo4jUri:env.NEO4J_URI,neo4jUser:env.NEO4J_USERNAME||'neo4j',neo4jPassword:env.NEO4J_PASSWORD,neo4jDatabase:env.NEO4J_DATABASE||'neo4j',
  modelUrl:(env.QWEN_BASE_URL||'http://127.0.0.1:8091').replace(/\/$/,''),model:env.QWEN_MODEL||'qwen-local-27b',modelPath:env.QWEN_MODEL_PATH,
  modelTimeout:Number(env.MODEL_TIMEOUT_MS||300000)};
