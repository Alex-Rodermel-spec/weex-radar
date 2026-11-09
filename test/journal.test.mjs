import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {encryptJournal,decryptJournal,mergeJournal,
 summarizeJournal,normalizeJournalRow,JOURNAL_DAYS} from '../lib/journal-core.mjs';
import {handleJournal} from '../lib/journal-route.mjs';

const env={PUSH_CRON_KEY:'u'.repeat(40),NTFY_TOPIC:'p'.repeat(32)};
const NOW=Date.UTC(2026,10,8,16,20,0);
const signal=(overrides={})=>({
 symbol:'BTCUSDT',direction:'LONG',level:'NORMAL',
 entry:100,stop:99,take:102,sentAt:NOW-5*60_000,
 status:'PENDING',outcomeAt:null,shadow:'OBSERVE',...overrides
});

test('90-day market signal archive is AES-256-GCM encrypted and authenticated',()=>{
 const rows=[signal()];
 const one=encryptJournal(rows,env),two=encryptJournal(rows,env);
 assert.equal(one.algorithm,'aes-256-gcm');
 assert.equal(one.version,1);
 assert.notEqual(one.iv,two.iv);
 assert.deepEqual(decryptJournal(one,env),rows);
 assert.ok(!JSON.stringify(one).includes('BTCUSDT'));
 const changed={...one,tag:'AAAAAAAAAAAAAAAAAAAAAA'};
 assert.throws(()=>decryptJournal(changed,env));
 assert.throws(()=>decryptJournal(one,{PUSH_CRON_KEY:'bad'.repeat(15),NTFY_TOPIC:env.NTFY_TOPIC}));
 assert.throws(()=>encryptJournal(rows,{NTFY_TOPIC:env.NTFY_TOPIC}));
});

test('merge deduplicates 20-minute poll overlap and never reverses a settled TP',()=>{
 const prior=[signal({status:'PENDING'})];
 const completed=signal({status:'TP',outcomeAt:NOW-60_000});
 const next=mergeJournal(prior,[completed,completed],NOW);
 assert.equal(next.changed,true);
 assert.equal(next.updated,1);
 assert.equal(next.added,0);
 assert.equal(next.rows.length,1);
 assert.equal(next.rows[0].status,'TP');
 const backwards=mergeJournal(next.rows,[signal({status:'NO_DATA'})],NOW);
 assert.equal(backwards.changed,false);
 assert.equal(backwards.rows[0].status,'TP');
 const same=mergeJournal(next.rows,[completed],NOW);
 assert.equal(same.changed,false);
});

test('90-day eviction drops older signals and rejects invalid claims',()=>{
 const older=signal({sentAt:NOW-91*24*60*60_000,status:'SL'});
 const recent=signal({symbol:'XRPUSDT'});
 const result=mergeJournal([older,recent],[],NOW);
 assert.equal(result.changed,true);
 assert.equal(result.dropped,1);
 assert.equal(result.rows.length,1);
 assert.equal(normalizeJournalRow(signal({stop:101}),NOW),null);
 assert.equal(normalizeJournalRow(signal({status:'FAKE_WIN'}),NOW),null);
 assert.equal(normalizeJournalRow(signal({symbol:'B@DUSDT'}),NOW),null);
 assert.equal(JOURNAL_DAYS,90);
});

test('30/90-day rollups count only resolved TP/SL with explicit no-fee R estimates',()=>{
 const rows=[
  signal({symbol:'BTCUSDT',status:'TP',shadow:'SKIP'}),
  signal({symbol:'BTCUSDT',status:'SL',sentAt:NOW-2*60_000,shadow:'OBSERVE'}),
  signal({symbol:'ETHUSDT',status:'PENDING',sentAt:NOW-7*60_000}),
  signal({symbol:'XRPUSDT',status:'TP',sentAt:NOW-50*24*60*60_000})
 ];
 const sum=summarizeJournal(rows,NOW);
 assert.equal(sum.windows[30].total,3);
 assert.deepEqual(sum.researchGoal,{
  target:100,collected:4,remaining:96,reached:false,resolved:3,
  basis:'Rolling 90-day archive of confirmed ntfy alerts; candle-only outcomes, not live trades',
  note:'100 alerts is a study checkpoint, NOT proof of profitability or a safe win rate.'
 });
 assert.equal(sum.windows[30].TP,1);
 assert.equal(sum.windows[30].SL,1);
 assert.equal(sum.windows[30].resolved,2);
 assert.equal(sum.windows[30].hitRatePct,50);
 assert.equal(sum.windows[30].illustrativeAverageR,0.5);
 assert.equal(sum.windows[90].TP,2);
 assert.equal(sum.windows[90].total,4);
 assert.equal(sum.windows[30].byMarket[0].name,'BTCUSDT');
 assert.equal(sum.windows[30].byShadow.find(x=>x.name==='SKIP').TP,1);
 assert.match(sum.limitations,/No actual order fills/);
});

test('writer endpoint rejects unsigned callers BEFORE fetching any ntfy/history',async()=>{
 const response={code:0,payload:null,headers:{},
  setHeader(k,v){this.headers[k]=v},
  status(code){this.code=code;return this},
  json(json){this.payload=json;return this}};
 await handleJournal({method:'GET',headers:{},query:{mode:'journal-export'}},
  response,'journal-export');
 assert.equal(response.code,401);
 assert.equal(response.payload.error,'Unauthorized journal writer');
 const rejected={...response,
  status(code){this.code=code;return this},json(json){this.payload=json;return this}};
 await handleJournal({method:'POST',headers:{},query:{mode:'journal'}},
  rejected,'journal');
 assert.equal(rejected.code,405);
});

test('new data-only writer cannot silently enable trading or publish plaintext',()=>{
 const writer=readFileSync(new URL('../.github/workflows/signal-journal.yml',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const core=readFileSync(new URL('../lib/journal-core.mjs',import.meta.url),'utf8');
 const main=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(writer,/weex-radar-journal/);
 assert.match(writer,/journal-data/);
 assert.match(writer,/journal-export/);
 assert.match(writer,/id-token: write/);
 assert.match(writer,/contents: write/);
 assert.match(writer,/cron: '7,27,47/);
 assert.doesNotMatch(writer,/PUSH_CRON_KEY|NTFY_TOPIC|curl.*market\/order/);
 assert.match(route,/jwtVerify/);
 assert.match(route,/WORKFLOW/);
 assert.match(core,/aes-256-gcm/);
 assert.match(main,/mode==='journal'/);
 assert.match(index,/href="\/history\.html"/);
 assert.match(site,/mode=journal/);
 assert.match(site,/goal-progress/);
 assert.match(site,/100 подтверждённых сигналов/);
 assert.doesNotMatch(dispatch,/journal-export/);
 assert.doesNotMatch(early,/journal-export/);
 assert.doesNotMatch(route,/trade-confirm|\/capi\/v3\/order/);
 const script=site.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
