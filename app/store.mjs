import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from './config.mjs';
mkdirSync(path.join(ROOT,'.runtime'),{recursive:true});
export function createConversationStore(filename){
const db=new DatabaseSync(filename);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,scope_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);`);
const now=()=>new Date().toISOString();
function newConversation(title,scope){const id=randomUUID(),time=now();db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run(id,title.slice(0,90),JSON.stringify(scope),time,time);return id;}
function getConversation(id){const c=db.prepare('SELECT * FROM conversations WHERE id=?').get(id);if(!c)return null;return {...c,scope:JSON.parse(c.scope_json),messages:db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid').all(id).map(m=>({...m,...(m.payload_json?JSON.parse(m.payload_json):{})}))};}
function listConversations(){return db.prepare('SELECT id,title,scope_json,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50').all().map(c=>({...c,scope:JSON.parse(c.scope_json)}));}
function addMessage(conversationId,role,content,status='complete',payload=null){const id=randomUUID();db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?)').run(id,conversationId,role,content,status,payload?JSON.stringify(payload):null,now());db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now(),conversationId);return id;}
function closeStore(){db.close();}

function deleteConversation(id){
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id);
    const result=db.prepare('DELETE FROM conversations WHERE id=?').run(id);
    db.exec('COMMIT');return result.changes>0;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
return {newConversation,getConversation,listConversations,addMessage,deleteConversation,closeStore};
}
export const {newConversation,getConversation,listConversations,addMessage,deleteConversation,closeStore}=createConversationStore(path.join(ROOT,'.runtime/teacher-app.sqlite'));
