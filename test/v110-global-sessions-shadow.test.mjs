import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {globalSessionAt,evaluateV110GlobalSessions as audit}
 from '../lib/v110-global-sessions-shadow.mjs';
const D=s=>Date.parse(s),NOW=D('2026-11-16T16:00:00Z');
const H=[1,5,10,15,30],w=(status='OBSERVED',move=20)=>({status,moveBps:move});
const record=(i,stamp,side='SHORT',v=20,patch={})=>({
 id:i.toString(16).padStart(32,'0'),symbol:'XRPUSDT',direction:side,
 sentAt:D(stamp),windows:Object.fromEntries(H.map(h=>[h,w('OBSERVED',v)])),...patch
});
test('IANA local windows correctly use Tokyo, London and NY DST',()=>{
 assert.equal(globalSessionAt(D('2026-11-15T00:30:00Z')).cohort,'TOKYO');
 assert.equal(globalSessionAt(D('2026-11-15T08:30:00Z')).cohort,'TOKYO+LONDON');
 assert.equal(globalSessionAt(D('2026-07-01T07:30:00Z')).cohort,'TOKYO+LONDON');
 assert.equal(globalSessionAt(D('2026-07-01T13:30:00Z')).cohort,'LONDON+NEW_YORK');
 assert.equal(globalSessionAt(D('2026-11-15T14:30:00Z')).cohort,'LONDON+NEW_YORK');
 assert.equal(globalSessionAt(D('2026-11-15T18:30:00Z')).cohort,'NEW_YORK');
 assert.equal(globalSessionAt(D('2026-11-15T23:59:00Z')).cohort,'OFF_HOURS');
 assert.equal(globalSessionAt(null),null);
});
test('US-Europe mismatched DST switch weeks are not shifted by static offset',()=>{
 assert.equal(globalSessionAt(D('2026-03-15T13:30:00Z')).cohort,'LONDON+NEW_YORK');
 assert.equal(globalSessionAt(D('2026-03-01T13:30:00Z')).cohort,'LONDON');
 assert.equal(globalSessionAt(D('2026-10-27T13:30:00Z')).cohort,'LONDON+NEW_YORK');
});
test('cohorts partition once, preserve LONG and SHORT and Berlin weekends',()=>{
 const rows=[
  record(1,'2026-11-15T00:30:00Z','LONG'),
  record(2,'2026-11-15T15:30:00Z','SHORT'),
  record(3,'2026-11-16T15:30:00Z','LONG'),
  record(4,'2026-11-16T13:30:00Z','SHORT'),
  record(5,'2026-11-16T00:30:00Z','LONG')
 ];
 const x=audit(rows,NOW);
 assert.equal(x.status,'DESCRIPTIVE_ONLY');
 assert.equal(x.uniquePublishedForecasts,5);
 assert.equal(Object.values(x.byCohort).reduce((sum,y)=>sum+y.alerts,0),5);
 assert.equal(x.byDayType.WEEKEND.alerts,2);
 assert.equal(x.byDayType.WEEKDAY.alerts,3);
 assert.equal(x.byDirectionAndCohort.LONG.TOKYO.alerts,2);
 assert.equal(x.byDirectionAndCohort.SHORT['LONDON+NEW_YORK'].alerts,1);
 assert.equal(x.ordersSent,0);
});
test('immature outcomes and unavailable candles remain unknown, not favorable or adverse',()=>{
 const near=record(1,'2026-11-16T15:57:00Z');
 const mature=record(2,'2026-11-16T13:00:00Z','SHORT',-15);
 mature.windows[1]=w('NO_DATA',null);
 mature.windows[5]=w('PENDING',null);
 mature.windows[10]=w('OBSERVED',NaN);
 const s=audit([near,mature],NOW).allPublished.horizons;
 assert.equal(s[1].immature,1);
 assert.equal(s[1].noDataAfterMaturity,1);
 assert.equal(s[5].pendingAfterMaturity,1);
 assert.equal(s[10].invalidAfterMaturity,1);
 assert.equal(s[15].observed,1);
 assert.equal(s[15].adverse,1);
 assert.equal(s[15].favorablePctDescriptive,null);
 assert.equal(s[30].immature,1);
});
test('repeat same-symbol alert, fake input and duplicate ID cannot boost rates',()=>{
 const rows=[];
 for(let i=0;i<30;i++){
  const day=String(11+Math.floor(i/10)).padStart(2,'0');
  const minute=String((i%10)*2).padStart(2,'0');
  rows.push(record(i+1,'2026-11-'+day+'T15:'+minute+':00Z',
    'LONG',i%2?20:-20));
 }
 rows.push(rows[0],{...rows[0],id:'INVALID'});
 const s=audit(rows,NOW);
 assert.equal(s.uniquePublishedForecasts,30);
 assert.equal(s.duplicateIds,1);
 assert.equal(s.invalidRows,1);
 assert.equal(s.allPublished.distinctBerlinDays,3);
 assert.equal(s.allPublished.horizons[15].observed,30);
 assert.equal(s.allPublished.horizons[15].favorablePctDescriptive,50);
 assert.equal(s.allPublished.horizons[15].spaced30mObserved,3);
 assert.equal(s.allPublished.horizons[15].spaced30mFavorablePctDescriptive,null);
 assert.equal(s.allPublished.repeatedSameSymbolWithin30m,27);
});
test('attractive 30 out of 30 samples on a single day cannot display a rate',()=>{
 const rows=Array.from({length:30},(_,i)=>record(i+1,
  '2026-11-15T15:'+String(i).padStart(2,'0')+':00Z','LONG'));
 const h=audit(rows,NOW).allPublished.horizons[10];
 assert.equal(h.observed,30);
 assert.equal(h.observedBerlinDays,1);
 assert.equal(h.favorable,30);
 assert.equal(h.favorablePctDescriptive,null);
});
test('existing encrypted journal is the sole source; scanner, ntfy and trading untouched',()=>{
 const mod=readFileSync(new URL('../lib/v110-global-sessions-shadow.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(route,/globalSessionsShadow:evaluateV110GlobalSessions\(forecastRows,now\)/);
 assert.equal(scan.includes('v110-global-sessions-shadow'),false);
 for(const bad of ['fetch(', 'process.env', '@vercel/blob','put(',
  'publishNtfy','placeOrder(', 'trade-confirm'])
  assert.equal(mod.includes(bad),false,bad);
 assert.equal(audit([],NOW).allPublished.horizons[15].observed,0);
 assert.equal(audit(null,NOW).status,'INVALID_INPUT');
 assert.equal(audit(Array(5001).fill(record(1,'2026-11-15T15:00:00Z')),NOW).status,'INVALID_INPUT');
});
