import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {normalizeEarlyArchiveRow,mergeEarlyArchive,summarizeEarlyArchive,
 MAX_EARLY_ROWS,EARLY_ARCHIVE_DAYS} from '../lib/early-journal.mjs';
import {encryptJournal,decryptJournal,decryptJournalArchive,
 summarizeJournal} from '../lib/journal-core.mjs';
const NOW=Date.UTC(2026,10,9,12,30,0),DAY=86400000,MINUTE=60000;
const env={PUSH_CRON_KEY:'s'.repeat(40),NTFY_TOPIC:'private'.repeat(6)};
const observed=(move=25)=>({status:'OBSERVED',moveBps:move,favorableBps:35,adverseBps:-10});
const pending=()=>({status:'PENDING',moveBps:null,favorableBps:null,adverseBps:null});
function early(overrides={}){
 return {symbol:'BTCUSDT',direction:'LONG',watchType:'PRE_BREAK',entry:100,
  sentAt:NOW-30*MINUTE,windows:{5:pending(),15:pending(),30:pending()},
  confirmation:null,...overrides};
}
test('accept real early rows, reject malformed or old sources without inventing observations',()=>{
 const row=early();
 assert.equal(normalizeEarlyArchiveRow(row,NOW).windows[5].status,'PENDING');
 for(const change of [{symbol:'BAD_SYMBOL'},{direction:'HOLD'},{watchType:'TRADE'},
  {entry:-1},{sentAt:NOW-91*DAY},{sentAt:NOW+15000},
  {windows:{5:{status:'WIN'},15:pending(),30:pending()}}]){
  assert.equal(normalizeEarlyArchiveRow({...row,...change},NOW),null);
 }
 assert.equal(EARLY_ARCHIVE_DAYS,90);
 assert.equal(MAX_EARLY_ROWS,2000);
});
test('collect new early alerts and progressively update ONLY completed horizons',()=>{
 const a=early(),with5=early({windows:{5:observed(35),15:pending(),30:pending()}});
 const five=mergeEarlyArchive([], [a,with5],NOW);
 assert.equal(five.added,1);
 assert.equal(five.updated,1);
 assert.equal(five.rows.length,1);
 assert.equal(five.rows[0].windows[5].moveBps,35);
 const final=mergeEarlyArchive(five.rows,[early({windows:{
  5:pending(),15:observed(-15),30:observed(22)
 },confirmation:{delayMinutes:8.3,chaseBps:11.2}})],NOW);
 assert.equal(final.updated,1);
 assert.equal(final.rows[0].windows[5].moveBps,35);
 assert.equal(final.rows[0].windows[15].moveBps,-15);
 assert.equal(final.rows[0].windows[30].moveBps,22);
 assert.equal(final.rows[0].confirmation.chaseBps,11.2);
 const stale=mergeEarlyArchive(final.rows,[early({windows:{
  5:{status:'NO_DATA'},15:{status:'NO_DATA'},30:{status:'NO_DATA'}
 }})],NOW);
 assert.equal(stale.changed,false);
 assert.deepEqual(stale.rows,final.rows);
});
test('archive drops 90-day-old signals, deduplicates, and has bounded size',()=>{
 const old=early({sentAt:NOW-91*DAY}),fresh=early();
 const r=mergeEarlyArchive([old,fresh],[fresh],NOW);
 assert.equal(r.rows.length,1);
 assert.equal(r.added,0);
 assert.equal(r.dropped,1);
 assert.throws(()=>mergeEarlyArchive([],Array.from({length:201},()=>fresh),NOW));
});
test('30/90-day summaries segregate PRE_BREAK and BREAKOUT, count only observed',()=>{
 const first=early({windows:{5:observed(20),15:observed(-10),30:pending()},
  confirmation:{delayMinutes:6,chaseBps:15}});
 const second=early({symbol:'ETHUSDT',watchType:'BREAKOUT',sentAt:NOW-31*DAY,
  windows:{5:observed(-20),15:observed(15),30:observed(40)}});
 const d=summarizeEarlyArchive([first,second],NOW);
 assert.equal(d.windows[30].total,1);
 assert.equal(d.windows[30].at5m.observed,1);
 assert.equal(d.windows[30].at5m.favorable,1);
 assert.equal(d.windows[30].at15m.adverse,1);
 assert.equal(d.windows[30].at30m.pending,1);
 assert.equal(d.windows[90].total,2);
 assert.equal(d.windows[90].at5m.favorablePct,50);
 assert.equal(d.windows[90].types.PRE_BREAK.total,1);
 assert.equal(d.windows[90].types.BREAKOUT.total,1);
 assert.equal(d.windows[30].pairs.confirmedWithin30m,1);
 assert.match(d.caveat,/NOT executed trades/);
});
test('early data are encrypted in original journal envelope, confirmed rows preserved',()=>{
 const confirmed={symbol:'BTCUSDT',direction:'LONG',level:'NORMAL',
  entry:100,stop:99,take:102,sentAt:NOW-5*MINUTE,
  status:'TP',outcomeAt:NOW-2*MINUTE,shadow:'OBSERVE'};
 const e=early();
 const cipher=encryptJournal([confirmed],env,[e]);
 assert.equal(cipher.algorithm,'aes-256-gcm');
 const raw=JSON.stringify(cipher);
 assert.doesNotMatch(raw,/BTCUSDT|PRE_BREAK|PUSH_CRON_KEY/);
 const restored=decryptJournalArchive(cipher,env);
 assert.deepEqual(restored.rows,[confirmed]);
 assert.deepEqual(restored.earlyRows,[e]);
 assert.deepEqual(decryptJournal(cipher,env),[confirmed]);
 const report=summarizeJournal([confirmed],NOW,[e]);
 assert.equal(report.archivedSignals,1);
 assert.equal(report.earlyStudy.archivedEarly,1);
 assert.throws(()=>decryptJournalArchive({...cipher,tag:'AAAAAAAAAAAAAAAAAAAAAA'},env));
});
test('ciphertext from previous journal version WITHOUT earlyRows remains readable',()=>{
 const confirmed=[{symbol:'ETHUSDT',direction:'SHORT',level:'NORMAL',
  entry:100,stop:101,take:98,sentAt:NOW-5*MINUTE,
  status:'SL',outcomeAt:NOW-2*MINUTE,shadow:'LEGACY'}];
 const key=createHash('sha256').update('weex:journal:v1\0')
  .update(env.PUSH_CRON_KEY).update('\0').update(env.NTFY_TOPIC).digest();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('WEEX-RADAR-JOURNAL-v1'));
 const plain=Buffer.from(JSON.stringify({version:1,days:90,rows:confirmed}));
 const bytes=Buffer.concat([cipher.update(plain),cipher.final()]);
 const archive={version:1,algorithm:'aes-256-gcm',iv:iv.toString('base64url'),
  tag:cipher.getAuthTag().toString('base64url'),
  ciphertext:bytes.toString('base64url')};
 assert.deepEqual(decryptJournalArchive(archive,env),{rows:confirmed,earlyRows:[],forecastRows:[],confirmedAuditRows:[]});
});
test('no trading, no new scheduling, no public individual early history',()=>{
 const journal=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const archive=readFileSync(new URL('../lib/early-journal.mjs',import.meta.url),'utf8');
 const collector=readFileSync(new URL('../lib/early-study-route.mjs',import.meta.url),'utf8');
 const earlyCore=readFileSync(new URL('../lib/early-study.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/signal-journal.yml',import.meta.url),'utf8');
 const home=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const scanner=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(journal,/authorizeJournal\(req\)/);
 assert.match(journal,/recentEarlyResearch\(now\)/);
 assert.match(journal,/mergeEarlyArchive\(/);
 assert.match(collector,/Object\.fromEntries\(Object\.entries\(study\)/);
 assert.match(earlyCore,/entry:a\.entry,sentAt:a\.sentAt/);
 assert.match(workflow,/cron: '7,27,47 \* \* \* \*'/);
 assert.match(workflow,/journal-export/);
 assert.match(home,/earlyTotal/);
 assert.match(home,/earlyDetail/);
 const script=home.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const src of [journal,archive,collector]){
  assert.doesNotMatch(src,/trade-confirm|placeOrder|\/capi\/v3\/order/);
 }
 assert.doesNotMatch(dispatch,/mergeEarlyArchive|recentEarlyResearch/);
 assert.doesNotMatch(scanner,/mergeEarlyArchive|recentEarlyResearch/);
});
