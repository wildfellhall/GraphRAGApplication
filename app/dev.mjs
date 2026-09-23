import {spawn} from 'node:child_process';
import {config,ROOT} from './config.mjs';
import {existsSync} from 'node:fs';
import path from 'node:path';
const children=[];
function start(command,args){const child=spawn(command,args,{cwd:ROOT,stdio:'inherit'});children.push(child);child.on('error',error=>console.error(error.message));return child;}
async function ready(url,ms=90000){const startTime=Date.now();while(Date.now()-startTime<ms){try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(r.ok)return true;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}return false;}
if(!await ready('http://127.0.0.1:7474/',2200)){
  console.log('Starting project-local Neo4j…');start('python3',['graph/local_neo4j.py','console']);
  if(!await ready('http://127.0.0.1:7474/'))throw Error('Neo4j did not start. Run npm run graph:setup first.');
}
if(!await ready(config.modelUrl+'/health',2200)){
  if(!config.modelPath||!existsSync(config.modelPath))throw Error('Set QWEN_MODEL_PATH in .app.env to your local Qwen 27B GGUF.');
  const url=new URL(config.modelUrl);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Configured model server is unavailable.');
  console.log('Loading the local Qwen GGUF…');
  start('llama-server',['--model',config.modelPath,'--host','127.0.0.1','--port',url.port||'8091','--alias',config.model,'--ctx-size','8192','--parallel','1','--gpu-layers','auto','--threads','6','--reasoning','off','--no-webui']);
  if(!await ready(config.modelUrl+'/health',180000))throw Error('Qwen did not become ready. Inspect the model server output.');
}
start(process.execPath,['app/server.mjs']);
start(process.execPath,['node_modules/vite/bin/vite.js','--config','web/vite.config.mjs']);
console.log('Meridian: http://127.0.0.1:4311');
function stop(){for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(0),500);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
