import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 toAuditReference,recentConfirmedDirectionResearch,mergeConfirmedDirectionArchive,
 summarizeConfirmedDirectionArchive
} from '../lib/confirmed-direction-journal.mjs';
import {encryptJournal,decryptJournalArchive,summarizeJournal} from '../lib/journal-core.mjs';

const MIN=60000,NOW=Date.UTC(2026,10,10,19,30,40),sentAt=NOW-40*MIN+20000;
const entry=100;
const SHORT={symbol:'BTCUSDT',direction:'SHORT',level:'NORMAL',
 entry,stop:101,take:98,sentAt,status:'SL'};
const LONG={...SHORT,symbol:'ETHUSDT',direction:'LONG',level:'STRONG',
 stop:99,take:102,status:'TP'};
const start=Math.ceil((sentAt+1)/MIN)*MIN;
function rawCandles(){
 const bars=Array.from({length:18},(_,i)=>{
  const t=Math.floor(sentAt/MIN)*MIN-(18-i)*MIN;
  const close=101-(i+1)*0.05;
  return [t,close,close+0.1,close-0.1,close,900];
 });
 for(let i=0;i<32;i++){
  const close=i<7?100.01:i<12?99.6:99.4;
  bars.push([start+i*MIN,close,close+0.1,close-0.1,close,900]);
 }
 return bars;
}
test('confirmed LONG SHORT reference is based ONLY on ntfy quality rows',()=>{
 const a=toAuditReference(SHORT,NOW);
 assert.equal(a.direction,'SHORT');
 assert.equal(a.strength,'STANDARD');
 assert.equal(a.reference,100);
 assert.match(a.id,/^[a-f0-9]{32}$/);
 assert.equal(toAuditReference(LONG,NOW).strength,'STRONG');
 assert.equal(toAuditReference({...SHORT,symbol:'FOOUSDT'},NOW),null);
 assert.equal(toAuditReference({...SHORT,status:'NOT_SENT'},NOW),null);
 assert.equal(toAuditReference({...SHORT,entry:102},NOW),null);
 assert.equal(toAuditReference({...SHORT,sentAt:NOW-120*MIN},NOW),null);
 assert.notEqual(toAuditReference(LONG,NOW).id,a.id);
});
test('study uses only closed WEEX candles, including prior 15m and 5m closes',async()=>{
 const urls=[];
 const fetchImpl=async url=>{
  urls.push(url);
  return {ok:true,text:async()=>JSON.stringify(rawCandles())};
 };
 const study=await recentConfirmedDirectionResearch([SHORT],NOW,{fetchImpl});
 assert.equal(study.seen,1);
 assert.equal(study.marketsFailed,0);
 assert.equal(study.rows.length,1);
 assert.equal(study.rows[0].windows[5].status,'OBSERVED');
 assert.ok(study.rows[0].windows[5].moveBps<0);
 assert.ok(study.rows[0].windows[10].moveBps>0);
 assert.ok(study.rows[0].preMove15mBps>0);
 assert.ok(study.rows[0].aligned5m[2].moveBps>0);
 assert.equal(urls.length,1);
 assert.match(urls[0],/interval=1m&limit=125/);
 assert.doesNotMatch(urls[0],/order|api-key|private/i);
});
test('summary keeps LONG and SHORT separate, and TP/SL is not confused with direction',async()=>{
 const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify(rawCandles())});
 const study=await recentConfirmedDirectionResearch([SHORT,LONG],NOW,{fetchImpl});
 const report=summarizeConfirmedDirectionArchive(study.rows,NOW);
 assert.equal(report.archivedConfirmedDirections,2);
 assert.equal(report.windows[30].byDirection.SHORT.total,1);
 assert.equal(report.windows[30].byDirection.LONG.total,1);
 assert.equal(report.windows[30].byLevel.STANDARD.total,1);
 assert.equal(report.windows[30].byLevel.STRONG.total,1);
 assert.equal(report.windows[30].byDirection.SHORT.at10m.favorablePct,100);
 assert.equal(report.windows[30].byDirection.LONG.at10m.favorablePct,0);
});
test('confirmed direction study is encrypted independently and does NOT overwrite legacy TP/SL',async()=>{
 const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify(rawCandles())});
 const study=await recentConfirmedDirectionResearch([SHORT],NOW,{fetchImpl});
 const saved=mergeConfirmedDirectionArchive([],study.rows,NOW);
 assert.equal(saved.added,1);
 const later=mergeConfirmedDirectionArchive(saved.rows,study.rows,NOW);
 assert.equal(later.changed,false);
 const env={PUSH_CRON_KEY:'u'.repeat(40),NTFY_TOPIC:'p'.repeat(32)};
 const legacy=[{symbol:'BTCUSDT',direction:'SHORT',level:'NORMAL',
  entry:100,stop:101,take:98,sentAt:NOW-10*MIN,
  status:'SL',outcomeAt:NOW-5*MIN,shadow:'LEGACY'}];
 const encrypted=encryptJournal(legacy,env,[],[],saved.rows);
 assert.ok(!JSON.stringify(encrypted).includes('BTCUSDT'));
 const decrypted=decryptJournalArchive(encrypted,env);
 assert.equal(decrypted.rows[0].status,'SL');
 assert.equal(decrypted.confirmedAuditRows.length,1);
 assert.equal(summarizeJournal(decrypted.rows,NOW,[],[],decrypted.confirmedAuditRows)
  .confirmedDirectionStudy.archivedConfirmedDirections,1);
 assert.deepEqual(decryptJournalArchive(encryptJournal([],env),env).confirmedAuditRows,[]);
});
test('when exchange data is missing, study never invents wins or losses',async()=>{
 const fetchImpl=async()=>{throw Error('WEEX not responding')};
 const study=await recentConfirmedDirectionResearch([SHORT],NOW,{fetchImpl});
 assert.equal(study.marketsFailed,1);
 assert.equal(study.rows.length,0);
 const report=summarizeConfirmedDirectionArchive([],NOW);
 assert.equal(report.windows[30].at10m.favorablePct,null);
});
test('private research does not enable orders, new cron, or expose individual alerts',()=>{
 const source=readFileSync(new URL('../lib/confirmed-direction-journal.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 assert.doesNotMatch(source,/placeOrder|trade-confirm|trade-prepare|order\/place|createPosition|NTFY_TOPIC\s*=/);
 assert.match(route,/recentConfirmedDirectionResearch/);
 assert.match(route,/encryptJournal\(merged.rows,process.env,earlyMerged.rows,forecastMerged.rows,confirmedMerged.rows\)/);
 assert.match(site,/confirmedAuditDirection/);
 const script=site.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
});
