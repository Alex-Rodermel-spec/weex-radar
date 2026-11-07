import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('signal push opens selected coin plan, not a real order',()=>{
 const dispatch=read('../api/push-dispatch.mjs'),sw=read('../sw.js'),page=read('../trade.html');
 assert.match(dispatch,/url:selected\.length===1&&primary\.exchange==='WEEX'/);
 assert.match(sw,/client\.navigate\(target\)/);
 assert.match(sw,/symbol=\[A-Z0-9\]/);
 assert.match(page,/coin\.includes\(symbolFromSignal\)/);
 assert.match(page,/Ордер не отправлен/);
 assert.doesNotThrow(()=>new Script(sw));
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
});
test('visible WEEX signal links to same coin without an order',()=>{
 const home=read('../index.html');
 assert.match(home,/href=\"\/trade\.html\?symbol=\$\{encodeURIComponent\(s\.symbol\)\}\"/);
 assert.match(home,/Проверить план сделки \(без ордера\)/);
 assert.match(home,/s\.exchange==='WEEX'/);
 const script=home.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
});
