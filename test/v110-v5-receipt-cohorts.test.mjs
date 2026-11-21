import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 summarizeForecastArchive,v5ReceiptAgreement
} from '../lib/forecast-journal.mjs';

const M=60000,now=Date.UTC(2026,10,21,10,45,40);
const at=now-40*M;
const horizons=[1,5,10,15,20,30];
function receipt(id,side,v5,move5=0,observed=true){
 return {
  id:id.repeat(32),symbol:'1000PEPEUSDT',direction:side,
  strength:'STANDARD',reference:0.0032,
  sentAt:at-Number.parseInt(id,16)*M,
  v5Direction:v5,
  windows:Object.fromEntries(horizons.map(h=>[h,
   h===5&&!observed?{status:'NO_DATA',moveBps:null}:
    {status:'OBSERVED',moveBps:h===5?move5:0}])),
  aligned5m:Object.fromEntries([1,2,3].map(h=>[h,{status:'NO_DATA',moveBps:null}])),
  preMove1mBps:null,preMove3mBps:null,preMove5mBps:null,
  preMove15mBps:null,preMove30mBps:null,
  firstFavorable10bpsMinute:null,firstAdverse10bpsMinute:null,
  v2Timing:null,depthShadow:null
 };
}
test('V4/V5 grouped audit is observation-only, separates MIXED vs OPPOSES vs absent evidence',()=>{
 const rows=[
  receipt('1','SHORT','MIXED',-40),
  receipt('2','SHORT','SHORT',10),
  receipt('3','SHORT','LONG',-60),
  receipt('4','SHORT',null,-10),
  receipt('5','LONG','MIXED',0,false),
 ];
 assert.deepEqual(rows.map(v5ReceiptAgreement),[
  'MIXED','AGREES','OPPOSES','NOT_RECORDED','MIXED'
 ]);
 const report=summarizeForecastArchive(rows,now);
 const groups=report.windows[30].v5ReceiptCohorts;
 assert.equal(groups.MIXED.total,2);
 assert.equal(groups.MIXED.at5m.observed,1);
 assert.equal(groups.MIXED.at5m.favorable,0);
 assert.equal(groups.MIXED.at5m.adverse,1);
 assert.equal(groups.MIXED.at5m.noData,1);
 assert.equal(groups.MIXED.byV4Direction.SHORT.total,1);
 assert.equal(groups.MIXED.byV4Direction.LONG.total,1);
 assert.equal(groups.AGREES.total,1);
 assert.equal(groups.AGREES.at5m.favorable,1);
 assert.equal(groups.OPPOSES.total,1);
 assert.equal(groups.OPPOSES.at5m.adverse,1);
 assert.equal(groups.NOT_RECORDED.total,1);
 assert.equal(groups.NOT_RECORDED.at5m.adverse,1);
 assert.equal(report.today.v5ReceiptCohorts.MIXED.total,2);
 assert.equal(groups.MIXED.at5m.favorablePct,0);
 assert.match(report.v5ReceiptDefinition,/not from future candles/);
 assert.match(report.v5ReceiptDefinition,/NOT.*profitable/i);
});
test('V5 audit never controls V4 delivery, NTFY volumes, trading or reconstructed price labels',()=>{
 const study=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const phone=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 assert.match(study,/v5ReceiptCohorts:v5ReceiptCohorts\(selected\)/);
 assert.match(study,/row\.v5Direction===.MIXED./);
 assert.match(study,/if\(!V5_DIRECTIONS\.has/);
 assert.match(phone,/forecastEligible\(d,now\)/);
 assert.match(phone,/MAX_PER_BUCKET=2/);
 assert.doesNotMatch(study,/placeOrder\(/);
 assert.doesNotMatch(phone,/WEEX_API_SECRET|\/capi\/v3\/order|placeOrder\(/);
});
