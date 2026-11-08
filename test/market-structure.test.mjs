import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {evaluateStructure} from '../lib/market-structure.mjs';
import {parseConfirmedNotification,aggregateQuality,aggregateShadowQuality}
 from '../lib/signal-quality.mjs';

function bars(direction='LONG',n=64){
 const sign=direction==='LONG'?1:-1;
 return Array.from({length:n},(_,i)=>{
  const close=100+sign*i*.12;
  return {time:1_000_000+i*300000,closeTime:1_000_000+(i+1)*300000,
   open:close-sign*.03,close,high:close+.08,low:close-.08,volume:100};
 });
}
function confirmed(title='🟣 СИЛЬНЫЙ XRPUSDT LONG',marker='· ТЕСТ: ПРОПУСТИТЬ'){
 return {event:'message',title,time:1794100000,message:
  'WEEX · цена 100 USDT · SL 99 · TP 102 · R/R 2:1 '+marker};
}

test('market structure is shadow-only, directional, and uses completed 5m data',()=>{
 const long=evaluateStructure(bars('LONG'),.2,'LONG');
 const short=evaluateStructure(bars('SHORT'),.2,'SHORT');
 for(const row of [long,short]){
  assert.equal(row.mode,'SHADOW');
  assert.equal(row.decision,'OBSERVE');
  assert.equal(row.warning,false);
  assert.equal(row.reasons.length,0);
  assert.equal(row.flat,false);
  assert.ok(row.context.widthAtr>4.5);
  assert.equal(row.retestConfirmed,false);
 }
 assert.equal(evaluateStructure(bars(),.2,'HOLD'),null);
 assert.equal(evaluateStructure(bars().slice(-10),.2,'LONG'),null);
 assert.equal(evaluateStructure(bars(),0,'LONG'),null);
});

test('a narrow sideways market is flagged for BOTH directions',()=>{
 for(const dir of ['LONG','SHORT']){
  const list=Array.from({length:64},(_,i)=>{
   const close=100+(i%2)*.01;
   return {time:i*300000,closeTime:(i+1)*300000,open:close,close,
    high:close+.10,low:close-.10,volume:100};
  });
  const result=evaluateStructure(list,.25,dir);
  assert.equal(result.flat,true);
  assert.equal(result.warning,true);
  assert.equal(result.decision,'SKIP');
  assert.match(result.label,/ПРОПУСТИТЬ/);
  assert.match(result.reasons.join(','),/боковик/);
 }
});

test('recent wick through a level that closes back inside is a failed breakout',()=>{
 for(const direction of ['LONG','SHORT']){
  const list=bars(direction);
  const i=list.length-3;
  const prior=list.slice(i-12,i);
  const level=direction==='LONG'?Math.max(...prior.map(c=>c.high)):
   Math.min(...prior.map(c=>c.low));
  const c=list[i];
  if(direction==='LONG'){
   c.high=level+.08;
   c.open=level-.06;c.close=level-.08;
   c.low=level-.15;
  }else{
   c.low=level-.08;
   c.open=level+.06;c.close=level+.08;
   c.high=level+.15;
  }
  const x=evaluateStructure(list,.25,direction);
  assert.equal(x.failedBreakAt,c.closeTime);
  assert.equal(x.warning,true);
  assert.match(x.reasons.join(' '),/ложный пробой/);
 }
});

test('a weak breakout with low participation gets a caution',()=>{
 const list=bars('LONG');
 const i=list.length-1,prev=list.slice(i-12,i);
 const upper=Math.max(...prev.map(c=>c.high));
 const current=list[i];
 current.open=upper-.10;
 current.close=upper+.015;
 current.high=upper+.07;
 current.low=upper-.11;
 current.volume=20;
 const r=evaluateStructure(list,.25,'LONG');
 assert.equal(r.weakBreakout,true);
 assert.equal(r.warning,true);
 assert.match(r.reasons.join(' '),/без роста объёма/);
});

test('invalid candles fail closed without inventing a market regime',()=>{
 const c=bars();
 c.at(-1).high=0;
 assert.equal(evaluateStructure(c,.25,'LONG'),null);
});

test('the ntfy history parser preserves shadow labels for honest cohort comparison',()=>{
 const a=parseConfirmedNotification(confirmed());
 const b=parseConfirmedNotification(confirmed('🟣 СИЛЬНЫЙ XRPUSDT LONG',
  '· ТЕСТ: БЕЗ ЗАМЕЧАНИЙ'));
 const legacy=parseConfirmedNotification(confirmed('🟣 СИЛЬНЫЙ XRPUSDT LONG',''));
 assert.equal(a.shadow,'SKIP');
 assert.equal(b.shadow,'OBSERVE');
 assert.equal(legacy.shadow,'LEGACY');
 const rows=[
  {...a,status:'TP'}, {...a,status:'SL'}, {...b,status:'TP'},
  {...b,status:'PENDING'}, {...legacy,status:'SL'}
 ];
 const grouped=aggregateShadowQuality(rows);
 assert.deepEqual({...grouped.SKIP},{total:2,TP:1,SL:1,resolved:2,observedWinRatePct:50});
 assert.equal(grouped.OBSERVE.total,2);
 assert.equal(grouped.OBSERVE.observedWinRatePct,100);
 assert.equal(grouped.LEGACY.total,1);
 assert.equal(aggregateQuality(rows).TP,2);
});

test('no live trade filter is changed; 1m early and cron remain independent',()=>{
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const quality=readFileSync(new URL('../quality.html',import.meta.url),'utf8');
 assert.match(signals,/candidate\?evaluateStructure\(five,volatility,candidate\):null/);
 assert.match(signals,/entryQuality\?\.ok\?candidate:null/);
 assert.doesNotMatch(dispatch,/evaluateStructure|shadowFilter/);
 assert.doesNotMatch(early,/evaluateStructure|shadowFilter/);
 assert.match(ntfy,/ТЕСТ: ПРОПУСТИТЬ/);
 assert.match(site,/ТЕСТ: ПРОПУСТИТЬ/);
 assert.match(quality,/shadowStats/);
 for(const page of [site,quality]){
  const script=page.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(()=>new Script(script[1]));
 }
 assert.doesNotMatch(signals,/\/capi\/v3\/order|trade-confirm/);
});
