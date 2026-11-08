import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {githubBackupStandby,STALE_MS} from '../lib/health-monitor.mjs';
const now=Date.UTC(2026,10,9,0,53,0);
function beat({age=10*60000,healthy=true,reachable=true,configured=true}={}){
 return {configured,reachable,last:{v:1,source:'cron',at:now-age,bucket:100,
  healthy,five:{total:16,weex:16,bybit:0,unavailable:0}}};
}
test('GitHub is standby when primary cron is recently verified healthy',()=>{
 assert.equal(githubBackupStandby(beat(),now),true);
 assert.equal(githubBackupStandby(beat({age:0}),now),true);
});
test('Degraded but active primary cron does not cause duplicate backup scans',()=>{
 assert.equal(githubBackupStandby(beat({healthy:false}),now),true);
 assert.equal(githubBackupStandby(beat({age:STALE_MS}),now),true);
});
test('Stale cron or unavailable monitoring enables fallback and never assumes health',()=>{
 assert.equal(githubBackupStandby(beat({age:STALE_MS+1}),now),false);
 assert.equal(githubBackupStandby({...beat(),last:null},now),false);
 assert.equal(githubBackupStandby(beat({reachable:false}),now),false);
 assert.equal(githubBackupStandby(beat({configured:false}),now),false);
 assert.equal(githubBackupStandby(null,now),false);
});
test('backup check occurs after authorization but before any scan, delivery or trading code',()=>{
 const source=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const first=source.indexOf("const source=await authorized(req)");
 const gate=source.indexOf("if(source==='github')");
 const early=source.indexOf('const earlyPromise=safeEarlyPush()');
 const five=source.indexOf("const response=await fetch('https://weex-radar.vercel.app/api/signals'");
 assert.ok(first>=0&&gate>first&&early>gate&&five>early);
 assert.match(source,/const heartbeat=await latestHeartbeat\(\)/);
 assert.match(source,/if\(githubBackupStandby\(heartbeat\)\)/);
 assert.match(source,/standby:true/);
 assert.match(source,/deliveryMode:'cron-primary\/github-backup'/);
 assert.match(source,/ntfySend\('confirmed',signals\)/);
 assert.doesNotMatch(source,/trade-confirm|placeOrder|\/capi\/v3\/order/);
});
