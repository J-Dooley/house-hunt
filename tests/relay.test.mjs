import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/gmail-relay.gs', import.meta.url), 'utf8');
const msg = (id) => ({getId:()=>id, getDate:()=>new Date(), getFrom:()=> 'Redfin <alerts@redfin.com>',getSubject:()=> 'Listing update',getBody:()=>'<p>123 Oak St, Redding, CA 96001</p>'});
function createHarness() {
  const store = new Map([['INBOUND_URL','https://example.supabase.co/functions/v1/househunt-inbound'],['INBOUND_SECRET','x'.repeat(32)]]);
  const messages=[msg('a')],sent=[];let responseCode=200;
  const props={getProperty:k=>store.get(k)??null,setProperty:(k,v)=>store.set(k,v),getProperties:()=>Object.fromEntries(store),deleteProperty:k=>store.delete(k)};
  const ctx={PropertiesService:{getScriptProperties:()=>props},GmailApp:{search:()=>[{getMessages:()=>messages}]},UrlFetchApp:{fetch:(url,payload)=>{sent.push(JSON.parse(payload.payload).messageId);return {getResponseCode:()=>responseCode,getContentText:()=>''};}},Logger:{log:()=>{}},Date,Object,String,Number,Error};
  vm.runInNewContext(source,ctx);
  return {run:()=>ctx.relayAlerts(),messages,sent,store,fail:()=>{responseCode=503;},succeed:()=>{responseCode=200;}};
}
test('same message is sent once even when the thread remains in search',()=>{
  const h=createHarness();h.run();h.run();assert.deepEqual(h.sent,['a']);
});
test('new message in an already-seen thread is still relayed',()=>{
  const h=createHarness();h.run();h.messages.push(msg('b'));h.run();assert.deepEqual(h.sent,['a','b']);
});
test('failed sends are retried rather than checkpointed',()=>{
  const h=createHarness();h.fail();h.run();h.succeed();h.run();assert.deepEqual(h.sent,['a','a']);
});
