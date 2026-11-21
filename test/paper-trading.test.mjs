import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAPER_POLICY,emptyPaperPortfolio,stepPaperPortfolio,publicPaperStatus}
 from '../lib/paper-trading.mjs';

const t=Date.UTC(2026,10,19,12,10),tick=100;
const quote=(p=tick,at=t)=>({bid:p-0.01,ask:p+0.01,time:at});
const signal=(symbol,direction='LONG',extras={})=>({
 symbol,direction,status:'ok',exchange:'WEEX',price:tick,
 candleCloseTime:t-10_000,expiresAt:t+90_000,
 stop:direction==='LONG'?99:101,
 take:direction==='LONG'?106:94,...extras
});
const symbols=['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','DOGEUSDT','ADAUSDT'];
const quotes=()=>Object.fromEntries(symbols.map(s=>[s,quote()]));
test('15 virtual EUR per different coin, max five concurrent and 10x; NO live orders',()=>{
 const x=stepPaperPortfolio(null,symbols.map(s=>signal(s)),quotes(),t);
 assert.equal(x.metrics.opened,5);
 assert.equal(x.portfolio.active.length,5);
 assert.deepEqual(x.portfolio.active.map(p=>p.symbol),symbols.slice(0,5));
 assert.ok(x.portfolio.active.every(p=>p.marginEur===15&&p.leverage===10&&p.notionalEur===150));
 assert.equal(x.metrics.ordersSent,0);
 assert.equal(PAPER_POLICY.maxModeledLossEur,3);
 assert.ok(x.portfolio.active.every(p=>p.entryFeatures?.schema==='v110-paper-entry-v1'&&
  p.entryFeatures.riskPolicy==='RISK_CAP_3_EUR'));

 assert.equal(publicPaperStatus(x.portfolio).totalAllocatedMarginEur,75);
 const replay=stepPaperPortfolio(x.portfolio,symbols.map(s=>signal(s)),quotes(),t+1000);
 assert.equal(replay.metrics.opened,0);
 assert.equal(replay.portfolio.active.length,5);
});
test('only WEEX confirmed fresh crypto, not forecast, stock, metal, 32-market WAIT',()=>{
 const s=[
  signal('XAUTUSDT'),signal('AMDUSDT'),
  signal('XRPUSDT','LONG',{status:'WAIT'}),
  signal('BTCUSDT','LONG',{exchange:'Bybit'}),
  signal('ETHUSDT','LONG',{expiresAt:t+1000}),
  signal('DOGEUSDT','LONG',{candleCloseTime:t-100_000}),
  signal('ADAUSDT')
 ];
 const q={...quotes(),XAUTUSDT:quote(),AMDUSDT:quote()};
 const o=stepPaperPortfolio(null,s,q,t);
 assert.equal(o.metrics.opened,1);
 assert.equal(o.portfolio.active[0].symbol,'ADAUSDT');
});
test('paper rejects new entries with modeled stop loss above 3 virtual EUR',()=>{
 const rejected=stepPaperPortfolio(null,[signal('BTCUSDT','LONG',{stop:97})],
  {BTCUSDT:quote()},t);
 assert.equal(rejected.metrics.opened,0);
 const good=stepPaperPortfolio(null,[signal('BTCUSDT','LONG',{
  closedFiveMinuteMoveBps:14.2,
  indicators:{rsi:62,volumeRatio:1.35,trend15:'UP',atr:0.4},
  retest:{LONG:{status:'CONFIRMED'}},
  costReview:{netRR:1.85,status:'PASS_ESTIMATE'},
  entryQuality:{ok:true}
 })],{BTCUSDT:quote()},t);
 assert.equal(good.metrics.opened,1);
 assert.deepEqual({
  late:good.portfolio.active[0].entryFeatures.preMove5mBps,
  rsi:good.portfolio.active[0].entryFeatures.rsi5m,
  netRR:good.portfolio.active[0].entryFeatures.modeledNetRR,
  retest:good.portfolio.active[0].entryFeatures.retestStatus
 },{late:14.2,rsi:62,netRR:1.85,retest:'CONFIRMED'});
});
test('stop, take, time-out, duplicate and same-symbol protections',()=>{
 const opened=stepPaperPortfolio(null,[signal('BTCUSDT'),signal('ETHUSDT','SHORT')],
 {BTCUSDT:quote(),ETHUSDT:quote()},t).portfolio;
 assert.equal(opened.active.length,2);
 const close=stepPaperPortfolio(opened,[signal('BTCUSDT'),signal('BTCUSDT')],
 {BTCUSDT:quote(97,t+60_000),ETHUSDT:quote(93,t+60_000)},t+60_000);
 assert.equal(close.metrics.closed,2);
 assert.equal(close.metrics.opened,0);
 assert.deepEqual(close.portfolio.closed.map(x=>x.reason),['STOP','TAKE']);
 assert.equal(close.portfolio.closedCount,2);
 const later=stepPaperPortfolio(close.portfolio,[signal('BTCUSDT','SHORT',
  {candleCloseTime:t+59_000,expiresAt:t+180_000})],
 {BTCUSDT:quote(100,t+61_000)},t+61_000);
 assert.equal(later.metrics.opened,1);
});
test('missing fresh quote blocks new entries and cannot falsely close positions',()=>{
 const open=stepPaperPortfolio(null,[signal('BTCUSDT')],{BTCUSDT:quote()},t).portfolio;
 const after=stepPaperPortfolio(open,[signal('ETHUSDT')],{ETHUSDT:quote(100,t+60_000)},t+60_000);
 assert.equal(after.metrics.opened,0);
 assert.equal(after.metrics.closed,0);
 assert.equal(after.metrics.missingQuotes,1);
});
test('drawdown stop blocks further simulation entries',()=>{
 const seed=emptyPaperPortfolio(t);
 seed.realizedNetEur=-16;
 const out=stepPaperPortfolio(seed,[signal('BTCUSDT')],{BTCUSDT:quote()},t);
 assert.equal(out.metrics.opened,0);
});
test('rejects corrupt ledger, wrong costs, inverted stops, stale/far quotes',()=>{
 assert.throws(()=>stepPaperPortfolio({...emptyPaperPortfolio(t),active:[{symbol:'BAD'}]},[],{},t),/INVALID_SAVED/);
 assert.equal(stepPaperPortfolio(null,[signal('BTCUSDT','LONG',{stop:110})],{BTCUSDT:quote()},t).metrics.opened,0);
 assert.equal(stepPaperPortfolio(null,[signal('BTCUSDT')],{BTCUSDT:quote(105)},t).metrics.opened,0);
 assert.equal(stepPaperPortfolio(null,[signal('BTCUSDT')],{BTCUSDT:quote(100,t-50_000)},t).metrics.opened,0);
});
test('paper runtime cannot import live trade module or perform an exchange order',()=>{
 const paper=readFileSync(new URL('../lib/paper-trading.mjs',import.meta.url),'utf8');
 const store=readFileSync(new URL('../lib/paper-trading-store.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(paper+store,/weex-order|trade-confirm|placeOrder|orderPayload|WEEX_API_(KEY|SECRET|PASSPHRASE)/);
 assert.match(dispatch,/runPaperTrading\(/);
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(store,/PAPER_ONLY/);
 assert.equal(PAPER_POLICY.maxPositions,5);
});
