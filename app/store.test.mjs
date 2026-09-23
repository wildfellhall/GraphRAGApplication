import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createConversationStore,closeStore} from './store.mjs';
after(closeStore);
test('deletion atomically removes the chosen conversation and all messages only',()=>{
  const store=createConversationStore(':memory:');
  const deleted=store.newConversation('Delete me',{}),kept=store.newConversation('Keep me',{});
  store.addMessage(deleted,'user','Question');store.addMessage(deleted,'assistant','Answer','complete',{evidence:[{id:'E1'}]});store.addMessage(kept,'user','Keep this question');
  assert.equal(store.deleteConversation(deleted),true);assert.equal(store.getConversation(deleted),null);
  assert.equal(store.getConversation(kept).messages.length,1);assert.equal(store.listConversations().length,1);
  assert.equal(store.deleteConversation(deleted),false);
  assert.throws(()=>store.addMessage(deleted,'assistant','Must not recreate deleted conversation'));
  store.closeStore();
});
