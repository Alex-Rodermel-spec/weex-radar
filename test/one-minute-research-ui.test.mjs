import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../one-minute-research.html',import.meta.url),'utf8');

test('minute research UI has syntactically valid browser JavaScript and explicit 16-market manual button',()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'one-minute-research.html'}));
 assert.match(html,/id="scan-all"/);
 assert.match(scripts[0][1],/\$\('scan-all'\)\.onclick\s*=/);
 assert.match(scripts[0][1],/ALL_WEEX_1M\.length/);
 assert.match(scripts[0][1],/LOOKBACK_CLOSED_1M/);
 assert.match(scripts[0][1],/acceptedByCautious/);
 assert.match(html,/истории последних пяти минут/);
 assert.match(html,/Никаких ордеров/);
});
