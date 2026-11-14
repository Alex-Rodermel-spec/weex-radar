import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const page=readFileSync(new URL('../history.html',import.meta.url),'utf8');
test('history page JS remains valid and all32 render is wired to report',()=>{
 const source=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(source);
 assert.doesNotThrow(()=>new Script(source));
 for(const id of ['v110All32Rows','v110All32Status','v110-all32-title']){
  assert.match(page,new RegExp('id="'+id+'"'));
 }
 assert.match(source,/renderV110All32\(report\.all32MarketAudit\)/);
 assert.match(source,/audit\.markets\.length!==32/);
 assert.match(source,/td\.textContent=String\(v\)/);
 assert.match(page,/Проценты по каждому инструменту скрываются при менее 20/);
});
