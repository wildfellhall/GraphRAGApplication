import express from 'express';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {config,ROOT} from './config.mjs';
import {driver,seedClasses,bootstrap,query} from './graph.mjs';
import {modelHealth} from './model.mjs';
import {runGraphRag} from './retrieval.mjs';
import {newConversation,getConversation,listConversations,addMessage,deleteConversation,closeStore} from './store.mjs';

const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');if(['POST','DELETE'].includes(req.method)){
  const origin=req.get('origin');if(origin&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return res.status(403).json({error:'Only local requests are accepted.'});
}next();});
app.get('/api/health',async(req,res)=>{
  const [graph,model]=await Promise.all([driver.verifyConnectivity().then(()=>true).catch(()=>false),modelHealth()]);
  res.json({graph,model,synthetic:true});
});
app.get('/api/bootstrap',async(req,res)=>{try{res.json({...await bootstrap(),conversations:listConversations()});}catch(error){res.status(503).json({error:'Neo4j is unavailable. Start the database and try again.'});}});
app.get('/api/conversations',(req,res)=>res.json(listConversations()));
app.get('/api/conversations/:id',(req,res)=>{const c=getConversation(req.params.id);if(!c)return res.status(404).json({error:'Conversation not found'});res.json(c);});
let busy=false,activeRun=null;
app.delete('/api/conversations/:id',(req,res)=>{
  const id=req.params.id;
  if(!getConversation(id))return res.status(404).json({error:'Conversation not found'});
  if(activeRun?.id===id){activeRun.deleted=true;activeRun.controller.abort(new Error('Conversation deleted'));}
  deleteConversation(id);
  res.json({deleted:true,id});
});
app.post('/api/chat',async(req,res)=>{
  const {question,scope={},conversationId}=req.body||{};
  if(typeof question!=='string'||!question.trim()||question.length>2400)return res.status(400).json({error:'Enter a question between 1 and 2,400 characters.'});
  if(typeof scope!=='object'||scope===null||Array.isArray(scope))return res.status(400).json({error:'Invalid scope'});
  if(['classId','studentId'].some(k=>scope[k]!==undefined&&typeof scope[k]!=='string'))return res.status(400).json({error:'Scope IDs must be strings'});
  if(busy)return res.status(409).json({error:'One answer is already being generated. Please wait or stop the current answer.'});
  const existing=conversationId?getConversation(conversationId):null;
  if(conversationId&&!existing)return res.status(404).json({error:'Conversation not found'});
  const effectiveScope=existing?.scope||{classId:scope.classId||'',studentId:scope.studentId||''};
  const id=existing?.id||newConversation(question.trim(),effectiveScope),controller=new AbortController();
  busy=true;const run={id,controller,deleted:false};activeRun=run;let finished=false;
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
  const emit=data=>{if(!res.destroyed)res.write(`data: ${JSON.stringify(data)}\n\n`);};
  const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
  res.on('close',()=>{if(!finished)controller.abort(new Error('Generation stopped'));});
  const userId=addMessage(id,'user',question.trim());emit({type:'conversation',id,userId});
  try{
    const result=await runGraphRag({question:question.trim(),scope:effectiveScope,history:existing?.messages||[],signal:controller.signal,emit});
    if(run.deleted)return;
    const messageId=addMessage(id,'assistant',result.content,'complete',result);emit({type:'done',message:{id:messageId,role:'assistant',status:'complete',...result}});
  }catch(error){
    if(run.deleted){emit({type:'error',message:'Conversation deleted.'});return;}
    const canceled=controller.signal.aborted;
    let message=canceled?'Generation stopped. No complete answer was saved.':error.message;
    if(/fetch failed|ECONN|timeout|timed out|aborted/i.test(message)&&!canceled)message='The local model or graph did not respond in time. Check the connections and try again.';
    message=message.replaceAll(config.neo4jPassword||'__no_secret__','[redacted]');
    const messageId=addMessage(id,'assistant',message,canceled?'canceled':'error');emit({type:'error',id:messageId,message});
  }finally{finished=true;busy=false;activeRun=null;clearInterval(heartbeat);res.end();}
});
const dist=path.join(ROOT,'web/dist');
app.use(express.static(dist));
app.get('/{*path}',(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:'API route not found'});
  if(existsSync(path.join(dist,'index.html')))return res.sendFile(path.join(dist,'index.html'));
  res.type('text').send('Run npm run web:dev for development, or npm run app:build for the production interface.');
});
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(400).json({error:'Invalid request body'});});
await driver.verifyConnectivity();await seedClasses();
const server=app.listen(config.port,'127.0.0.1',()=>console.log(`Meridian API and built UI: http://127.0.0.1:${config.port}`));
async function close(){server.close();await driver.close();closeStore();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);
