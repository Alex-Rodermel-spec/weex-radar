import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('browser alerts are suppressed when verified push is active',()=>{
 assert.match(html,/let latest=null,busy=false,backgroundPushReady=false/);
 assert.match(html,/function emitNotifications\(\)\{\s*\/\/[^\n]*\n if\(backgroundPushReady\)return;/);
 assert.match(html,/if\(checked\.present\)\{\s*backgroundPushReady=true/);
 assert.match(html,/backgroundPushReady=Boolean\(result\.testSent\)/);
});
test('service worker reuses browser notification tag to replace duplicate alerts',()=>{
 assert.match(sw,/tag:'weex-radar-'/);
 assert.match(sw,/String\(msg\.direction\|\|''\)/);
 assert.match(html,/weex-radar-\$\{s\.exchange\}-\$\{s\.symbol\}-\$\{s\.candleCloseTime\}-\$\{s\.direction\}/);
});
test('blocked site permissions require browser action, not forced auto-permission',()=>{
 assert.match(html,/Chrome заблокировал push/);
 assert.match(html,/if\(!interactive&&Notification\.permission!=='granted'\)/);
 const block=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(block);
 assert.doesNotThrow(()=>new Script(block[1],{filename:'index.html'}));
 assert.doesNotThrow(()=>new Script(sw,{filename:'sw.js'}));
});
