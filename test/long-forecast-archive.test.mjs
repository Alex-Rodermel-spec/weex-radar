import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,createCipheriv} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {encryptJournal,decryptJournalArchive} from '../lib/journal-core.mjs';
import {MAX_FORECAST_ROWS,mergeForecastArchive,summarizeForecastArchive}
 from '../lib/forecast-journal.mjs';

const env={PUSH_CRON_KEY:'K'.repeat(42),NTFY_TOPIC:'wr-'+'a'.repeat(32)};
const DAY=86400000,MIN=60000,now=Date.parse('2026-11-25T22:00:00Z');
const observed=move=>({status:'OBSERVED',moveBps:move});
function forecast(i){
 const windows={1:observed(12),5:observed(i%2?25:-16),
  10:observed(i%2?20:-20),15:observed(i%2?15:-15),
  30:observed(i%2?10:-10)};
 return {
  id:i.toString(16).padStart(32,'0'),
  symbol:['BTCUSDT','XRPUSDT','ETHUSDT','ZECUSDT'][i%4],
  direction:i%2?'SHORT':'LONG',
  strength:i%8===0?'STRONG':i%8===1?'CAUTION':'STANDARD',
  sentAt:now-4200*5*MIN+i*5*MIN,
  reference:100+i%1000/10000,windows,
  aligned5m:{1:observed(2),2:observed(5),3:observed(-2)},
  preMove5mBps:i%11===0?30:0,
  preMove15mBps:i%5===0?35:0,
  v2Timing:i%4===0?'LATE':'CLEAR',
  firstFavorable10bpsMinute:3,firstAdverse10bpsMinute:null
 };
}
test('larger encrypted forecast archive retains a whole prospective 14-day sample',()=>{
 assert.equal(MAX_FORECAST_ROWS,5000);
 const rows=Array.from({length:4200},(_,i)=>forecast(i));
 const merged=mergeForecastArchive([],rows.slice(0,100),now);
 assert.equal(merged.rows.length,100);
 let backlog=merged.rows;
 for(let i=100;i<rows.length;i+=100)
  backlog=mergeForecastArchive(backlog,rows.slice(i,i+100),now).rows;
 assert.equal(backlog.length,4200);
 const encrypted=encryptJournal([],env,[],backlog);
 assert.equal(encrypted.algorithm,'aes-256-gcm');
 assert.equal(encrypted.version,1);
 assert.equal(encrypted.compression,'deflate-raw');
 assert.ok(JSON.stringify(encrypted).length<2_200_000);
 assert.ok(!JSON.stringify(encrypted).includes('BTCUSDT'));
 const decoded=decryptJournalArchive(encrypted,env);
 assert.deepEqual(decoded.forecastRows,backlog);
 const report=summarizeForecastArchive(decoded.forecastRows,now);
 assert.equal(report.archivedForecasts,4200);
 assert.ok(report.windows[30].hypothesisAudit.forward.total>4000,
  'no silent rolling truncation during the 14-day prospective study');
 assert.equal(report.windows[30].at5m.observed,4200);
 assert.throws(()=>decryptJournalArchive({...encrypted,tag:'AAAAAAAAAAAAAAAAAAAAAA'},env));
 assert.throws(()=>decryptJournalArchive(encrypted,{
  ...env,PUSH_CRON_KEY:'L'.repeat(42)}));
 assert.throws(()=>decryptJournalArchive({...encrypted,compression:'gzip'},env),
  /JOURNAL_BAD_COMPRESSION/);
});
test('legacy uncompressed authenticated v1 remains readable after migration',()=>{
 const rows=[forecast(2)];
 const plain=Buffer.from(JSON.stringify({
  version:1,days:90,rows:[],earlyRows:[],forecastRows:rows,
  confirmedAuditRows:[]
 }));
 const key=createHash('sha256').update('weex:journal:v1\0')
  .update(env.PUSH_CRON_KEY).update('\0').update(env.NTFY_TOPIC).digest();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('WEEX-RADAR-JOURNAL-v1'));
 const bytes=Buffer.concat([cipher.update(plain),cipher.final()]);
 const legacy={version:1,algorithm:'aes-256-gcm',
  iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),
  ciphertext:bytes.toString('base64url')};
 assert.deepEqual(decryptJournalArchive(legacy,env).forecastRows,rows);
});
test('bounded inflate rejects a validly encrypted oversized decompression bomb',()=>{
 const key=createHash('sha256').update('weex:journal:v1\0')
  .update(env.PUSH_CRON_KEY).update('\0').update(env.NTFY_TOPIC).digest();
 const payload=deflateRawSync(Buffer.from('x'.repeat(8_100_000)),{level:6});
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('WEEX-RADAR-JOURNAL-v1'));
 const bytes=Buffer.concat([cipher.update(payload),cipher.final()]);
 const envelope={version:1,algorithm:'aes-256-gcm',compression:'deflate-raw',
  iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),
  ciphertext:bytes.toString('base64url')};
 assert.throws(()=>decryptJournalArchive(envelope,env));
});
