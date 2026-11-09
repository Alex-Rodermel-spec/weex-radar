import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {newFlow,requiredFlow,clearFlowCookie,readPasskey,storePasskey,
 registrationOptions,authenticationOptions,tradeContext,sessionForPasskey,RP_ID,ORIGIN} from '../lib/trade-passkey.mjs';
import handler from '../api/trade-passkey.mjs';

const previous=process.env.WEEX_TRADE_APPROVAL_PASSWORD;
const secret='unit-test-password-32-characters!';
process.env.WEEX_TRADE_APPROVAL_PASSWORD=secret;
const headers={host:'weex-radar.vercel.app',origin:'https://weex-radar.vercel.app',
 'content-type':'application/json','x-radar-trade-intent':'manual-confirm'};
const res=()=>({statusCode:0,headers:{},
 setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}});
const req=(action,body={},extra={})=>({method:'POST',headers:{...headers,...extra},body:{action,...body}});
const cred={v:1,id:'S'.repeat(45),publicKey:'A'.repeat(60),counter:0,transports:['internal']};

test('RP and origin are fixed to public production HTTPS, not another website',()=>{
 assert.equal(RP_ID,'weex-radar.vercel.app');
 assert.equal(ORIGIN,'https://weex-radar.vercel.app');
});
test('phone Passkey login grants 24-hour session but leaves trade signature separate',()=>{
 const before=Date.now();
 const session=sessionForPasskey();
 const after=Date.now();
 assert.ok(session.expiresAt>=before+24*60*60*1000);
 assert.ok(session.expiresAt<=after+24*60*60*1000);
 assert.match(session.cookie,/Max-Age=86400/);
 assert.match(session.cookie,/HttpOnly/);
 assert.match(session.cookie,/Secure/);
 assert.match(session.cookie,/SameSite=Strict/);
});
test('short challenge cookie binds mode, exact proposal hash, expiration and signature',()=>{
 const now=Date.now(),c='A'.repeat(43),ctx=tradeContext('a'.repeat(64));
 const {cookie}=newFlow('trade',c,ctx,now);
 for(const flag of ['Secure','HttpOnly','SameSite=Strict','Max-Age=90','Path=/'])
  assert.ok(cookie.includes(flag),flag);
 assert.doesNotMatch(cookie,/Domain=/);
 const raw=cookie.split(';')[0],request={headers:{cookie:raw}};
 assert.equal(requiredFlow(request,'trade',ctx,now+2000).challenge,c);
 assert.throws(()=>requiredFlow(request,'login','',now+2000),/challenge/);
 assert.throws(()=>requiredFlow(request,'trade',tradeContext('b'.repeat(64)),now+2000),/challenge/);
 assert.throws(()=>requiredFlow(request,'trade',ctx,now+90_001),/expired/);
 assert.throws(()=>requiredFlow({headers:{cookie:raw+'; '+raw}},'trade',ctx,now),/missing/);
 assert.throws(()=>requiredFlow({headers:{cookie:raw.replace(/.$/,'x')}},'trade',ctx,now),/signature/);
 assert.match(clearFlowCookie(),/Max-Age=0/);
});
test('passkey options request device user verification, not password-only authorization',async()=>{
 const reg=await registrationOptions();
 assert.equal(reg.options.rp.id,RP_ID);
 assert.equal(reg.options.authenticatorSelection.userVerification,'required');
 assert.equal(reg.options.authenticatorSelection.authenticatorAttachment,'platform');
 assert.equal(reg.options.attestation,'none');
 const {options}=await authenticationOptions('login','',cred);
 assert.equal(options.userVerification,'required');
 assert.equal(options.allowCredentials.length,1);
 assert.equal(options.allowCredentials[0].id,cred.id);
});
test('only validated public-key records are stored and private storage enforced',async()=>{
 const rows=[];
 await storePasskey(cred,false,async(path,raw,opts)=>{
  rows.push({path,raw,opts});return {url:'private'};
 });
 assert.match(rows[0].path,/trading\/passkey-v1\/owner.json/);
 assert.equal(rows[0].opts.access,'private');
 assert.equal(rows[0].opts.allowOverwrite,false);
 assert.deepEqual(JSON.parse(rows[0].raw),cred);
 const loaded=await readPasskey(async()=>({stream:new Response(JSON.stringify(cred)).body}));
 assert.deepEqual(loaded,cred);
 assert.equal(await readPasskey(async()=>null),null);
 await assert.rejects(()=>readPasskey(async()=>({stream:new Response('{"v":1}').body})),/record invalid/);
});
test('WebAuthn endpoint refuses foreign origin, unapproved enrollment and unauthenticated order challenge',async()=>{
 const bad=res();await handler(req('login-begin',{}, {origin:'https://bad.example'}),bad);
 assert.equal(bad.statusCode,403);
 const register=res();await handler(req('register-begin'),register);
 assert.equal(register.statusCode,401);
 const trade=res();await handler(req('trade-begin',{proposal:'a'.repeat(64)}),trade);
 assert.equal(trade.statusCode,401);
 const method=res();await handler({...req('login-begin'),method:'GET'},method);
 assert.equal(method.statusCode,405);
});
test('trade execution requires a fresh passkey signature after registration',()=>{
 const code=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const pk=readFileSync(new URL('../lib/trade-passkey.mjs',import.meta.url),'utf8');
 assert.match(code,/verifyLiveTradePasskey\(req,req\.body\.proposal\)/);
 assert.ok(code.indexOf('verifyLiveTradePasskey')<code.indexOf('await weex.placeOrder'));
 assert.match(pk,/if\(!record\)return \{required:false\}/);
 assert.match(pk,/authenticatedAssertion\(req,req\.body\?\.passkeyAssertion,'trade',tradeContext\(proposal\),record\)/);
 assert.match(code,/CONFIRM_REAL_WEEX_ORDER/);
 assert.match(code,/if\(!liveEnabled\(\)\)/);
 assert.match(code,/await put\(LOCK,/);
});
test('UI uses native device credential APIs; no biometric data or private-key storage',()=>{
 const ui=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 const script=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1]));
 for(const id of ['finger-login','finger-register'])assert.match(ui,new RegExp('id="'+id+'"'));
 assert.match(ui,/navigator\.credentials\.create/);
 assert.match(ui,/navigator\.credentials\.get/);
 assert.match(ui,/trade-begin/);
 assert.match(ui,/passkeyAssertion/);
 assert.doesNotMatch(ui,/localStorage\.setItem|sessionStorage\.setItem|fingerprintData|biometricTemplate/);
});
test.after(()=>{if(previous===undefined)delete process.env.WEEX_TRADE_APPROVAL_PASSWORD;
 else process.env.WEEX_TRADE_APPROVAL_PASSWORD=previous;});
