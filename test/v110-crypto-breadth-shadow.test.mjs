import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {V110_CRYPTO_BREADTH_POLICY as POLICY,summarizeV110CryptoBreadth as breadth}
 from '../lib/v110-crypto-breadth-shadow.mjs';

const now=Date.UTC(2026,10,15,3,40,30),MIN=60000,FIVE=5*MIN;
const crypto=profileSymbols().filter(s=>marketForecastProfile(s).group.endsWith('CRYPTO'));
const nonCrypto=profileSymbols().filter(s=>!marketForecastProfile(s).group.endsWith('CRYPTO'));
const spy=(symbol,body=-20,context='SHORT_BIAS',one='SHORT_BIAS',t=now-30_000)=>({
 available:true,exchange:'WEEX',symbol,
 timeframes:[
  {intervalMinutes:1,direction:one,closedAt:t},
  {intervalMinutes:5,direction:context,closedAt:Math.floor(now/FIVE)*FIVE,
   lastCandleBodyBps:body},
  {intervalMinutes:10,direction:context,closedAt:Math.floor(now/(2*FIVE))*(2*FIVE)}
 ]});
test('universe has 16 genuine crypto markets vs 16 equity/FX/metals',()=>{
 assert.equal(profileSymbols().length,32);
 assert.equal(crypto.length,16);
 assert.equal(nonCrypto.length,16);
 assert.equal(POLICY.actualCryptoInstruments,16);
 assert.equal(POLICY.noNewRequests,true);
 assert.equal(POLICY.noPaidApi,true);
 assert.equal(POLICY.noLiveFilters,true);
});
test('same-close 16 crypto 5m snapshot registers broad down with XRP countertrend and no 24h claims',()=>{
 const c=crypto.map((symbol,i)=>spy(symbol,i<13?-20:30,
  i<13?'SHORT_BIAS':'LONG_BIAS',
  i<13?'SHORT_BIAS':'LONG_BIAS'));
 // ensure XRP is explicitly rising against negative majority
 const x=c.find(d=>d.symbol==='XRPUSDT');
 x.timeframes[1].lastCandleBodyBps=120;
 x.timeframes[0].direction='LONG_BIAS';
 x.timeframes[1].direction='SHORT_BIAS';
 const out=breadth([...c,...nonCrypto.map(s=>spy(s,100))],now);
 assert.equal(out.status,'COMPLETE_CRYPTO16_SAME_5M_CLOSE');
 assert.equal(out.eligibleCryptoObservations,16);
 assert.equal(out.closed5m.regime,'BROAD_CRYPTO16_DOWN_5M');
 assert.equal(out.closed5m.down,12);
 assert.equal(out.closed5m.up,4);
 assert.equal(out.closed5m.downPct,75);
 assert.equal(out.universe.nonCryptoTotal,16);
 assert.equal(out.byGroup.MAJOR_CRYPTO.expected,2);
 assert.equal(out.byGroup.ALT_CRYPTO.expected,11);
 assert.equal(out.byGroup.MEME_CRYPTO.expected,3);
 assert.equal(out.oneMinuteOpposesFiveMinute,1);
 assert.ok(out.xrpRelativeToCryptoMedianBps>0);
 assert.equal(out.noTrade,true);
 assert.equal(out.paidApiCalls,0);
 assert.match(out.warning,/Not the Crypto Bubbles 24h period/);
});
test('partial cohort is UNKNOWN rather than misleading favorable market regime',()=>{
 const without=crypto.slice(0,15).map(s=>spy(s,-400));
 const out=breadth(without,now);
 assert.equal(out.status,'INCOMPLETE_CRYPTO16_COHORT');
 assert.equal(out.closed5m.down,15);
 assert.equal(out.closed5m.regime,'UNKNOWN');
 assert.equal(out.closed5m.downPct,null);
 assert.equal(out.missingCryptoCount,1);
});
test('old or inconsistent 5m candle closes cannot be mixed',()=>{
 const rows=crypto.map(s=>spy(s,10));
 rows[0].timeframes[1].closedAt-=FIVE;
 const x=breadth(rows,now);
 assert.equal(x.status,'INCOMPLETE_CRYPTO16_COHORT');
 assert.equal(x.eligibleCryptoObservations,15);
 assert.equal(x.closed5m.regime,'UNKNOWN');
});
test('stale 16/16 5m cohort is UNKNOWN even when all symbols have same old close',()=>{
 // Real production 15 Nov: first 10:50Z scan still held 10:40Z closes,
 // subsequent 10:51Z scan had 10:50Z closes. These are NOT the same
 // expected latest closed candle and must not be directly compared.
 const rows=crypto.map(s=>spy(s,100,'LONG_BIAS','LONG_BIAS'));
 for(const d of rows)d.timeframes[1].closedAt-=2*FIVE;
 const x=breadth(rows,now);
 assert.equal(x.status,'INCOMPLETE_CRYPTO16_COHORT');
 assert.equal(x.eligibleCryptoObservations,0);
 assert.equal(x.missingCryptoCount,16);
 assert.equal(x.closed5m.regime,'UNKNOWN');
 assert.equal(x.closed5m.upPct,null);
 assert.equal(x.latestExpected5mCloseAt,Math.floor((now-1000)/FIVE)*FIVE);
});
test('fail closed when latest 5m bar has not fully closed yet',()=>{
 // At exactly 03:40:00, the 03:35–03:40 bar is not yet confirmed
 // by the forecast closed-candle rule's 1-second safety margin.
 const exactly=Date.UTC(2026,10,15,3,40,0);
 const rows=crypto.map(s=>spy(s,-10));
 const x=breadth(rows,exactly);
 assert.equal(x.closed5m.regime,'UNKNOWN');
 assert.equal(x.status,'INCOMPLETE_CRYPTO16_COHORT');
});
test('future, stale, duplicate, non-WEEX and malformed data cannot create false complete sample',()=>{
 let rows=crypto.map(s=>spy(s,20));
 rows[0].timeframes[0].closedAt=now+5000;
 assert.equal(breadth(rows,now).status,'INCOMPLETE_CRYPTO16_COHORT');
 rows=crypto.map(s=>spy(s,20));
 rows[0].exchange='Bybit';
 assert.equal(breadth(rows,now).status,'INCOMPLETE_CRYPTO16_COHORT');
 rows=crypto.map(s=>spy(s,20));
 rows[0].timeframes[1].lastCandleBodyBps=NaN;
 assert.equal(breadth(rows,now).status,'INCOMPLETE_CRYPTO16_COHORT');
 rows=crypto.map(s=>spy(s,20));
 rows.push(spy(crypto[0],-100));
 const x=breadth(rows,now);
 assert.equal(x.eligibleCryptoObservations,16);
 assert.equal(x.invalidOrDuplicateCrypto,1);
 assert.equal(x.closed5m.up,16);
 assert.equal(x.closed5m.regime,'BROAD_CRYPTO16_UP_5M');
});
test('5m indicator votes cannot override actual closed-candle breadth',()=>{
 const rows=crypto.map((s,i)=>spy(s,i<12?-10:5,'LONG_BIAS','NEUTRAL'));
 const x=breadth(rows,now);
 assert.equal(x.closed5m.regime,'BROAD_CRYPTO16_DOWN_5M');
 assert.equal(x.fiveMinuteIndicatorBias.long,16);
 assert.equal(x.closed5m.down,12);
});
test('module is pure and only wired into existing 10m research snapshot path',()=>{
 const src=readFileSync(new URL('../lib/v110-crypto-breadth-shadow.mjs',import.meta.url),'utf8');
 for(const keyword of ['fetch(', 'process.env','@vercel/blob','publishNtfy','placeOrder(', 'trade-confirm'])
  assert.equal(src.includes(keyword),false,keyword);
 const f=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 assert.match(f,/cryptoBreadthResearch=summarizeV110CryptoBreadth\(researchObservations,now\)/);
 const p=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(p,/v110-crypto-breadth-shadow/);
});
