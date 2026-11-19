import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
const semi=script.split('// Semi-automatic CLIENT-SIDE selection only.')[1]
 ?.split("$('accept').onchange=")[0]||'';

test('semi-auto browser implementation is valid JS and user-initiated',()=>{
 assert.doesNotThrow(()=>new Script(script));
 assert.match(html,/id="auto-toggle" disabled/);
 assert.match(html,/id="auto-status"/);
 assert.match(script,/\$\('auto-toggle'\)\.onclick/);
 assert.match(semi,/if\(!sessionActive\)/);
 assert.match(script,/if\(!autoReviewOn\|\|!sessionActive\|\|autoReviewBusy\|\|busy\|\|/);
 assert.match(semi,/document\.hidden/);
 assert.match(semi,/setInterval\(\(\)=>\{if\(autoReviewOn\)/);
});
test('semi-auto uses only confirmed fresh WEEX REVIEW crypto, never forecast or paper',()=>{
 assert.match(semi,/s\.exchange==='WEEX'/);
 assert.match(semi,/s\.advisor\?\.status==='REVIEW'/);
 assert.match(semi,/s\.entryQuality\?\.ok===true/);
 assert.match(semi,/s\.costReview\?\.status==='PASS_ESTIMATE'/);
 assert.match(semi,/now-s\.candleCloseTime<=90000/);
 assert.match(semi,/s\.symbol!=='XAUTUSDT'/);
 assert.match(semi,/autoSeen\.has\(id\)/);
});
test('server preflight and proposal are automatic but real execution remains click-only',()=>{
 assert.match(semi,/ownerPreflight\(candidate\.symbol\)/);
 assert.match(script,/post\('\/api\/trade-preflight'/);
 assert.match(semi,/if\(!check\.passed\|\|!check\.liveEnabled\)continue/);
 assert.match(semi,/ownerPrepare\(candidate\.symbol\)/);
 assert.match(script,/post\('\/api\/trade-prepare'/);
 assert.doesNotMatch(semi,/post\('\/api\/trade-confirm'|weex\.placeOrder|post\('\/api\/trade-passkey'|verifyPhonePasskey/);
 assert.match(script,/\$\('confirm'\)\.onclick=.+/);
 assert.match(script,/confirmation:'CONFIRM_REAL_WEEX_ORDER'/);
 assert.match(script,/if\(passkeyEnrolled\)/);
 assert.match(html,/15 USDT \(не 15 €\)/);
 assert.match(html,/до 5 одновременно открытых позиций RADAR/);
});
test('auto mode clears proposals on exit and hidden tab; never persists approval',()=>{
 assert.match(semi,/if\(autoReviewOn&&approvalToken\)reset\(\)/);
 assert.match(script,/if\(!active\)\{\s*autoReviewOn=false/);
 assert.match(semi,/Неподтверждённый план сброшен/);
 assert.doesNotMatch(semi,/localStorage|sessionStorage|WEEX_API_SECRET/);
});
