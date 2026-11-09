import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 issueTradeSession,verifyTradeSession,authenticatedTradeSession,
 cookieForSession,cookieForLogout,SESSION_SECONDS,SESSION_COOKIE
} from '../lib/trade-session.mjs';
import handler from '../api/trade-session.mjs';

const env={WEEX_TRADE_APPROVAL_PASSWORD:'correct-horse-battery-staple-01'};
const now=Date.UTC(2026,10,9,14,0,0);
const baseHeaders={'host':'weex-radar.vercel.app','origin':'https://weex-radar.vercel.app',
 'content-type':'application/json','x-radar-trade-intent':'manual-confirm'};
const resp=()=>({headers:{},statusCode:0,body:null,
 setHeader(k,v){this.headers[k]=v;return this},
 status(n){this.statusCode=n;return this},json(x){this.body=x;return this}});
const req=(action,password,headers={})=>({
 method:'POST',headers:{...baseHeaders,...headers},body:{action,password}
});

test('signed session expires at exactly 24 hours and never contains password',()=>{
 const {token,expiresAt}=issueTradeSession(now,env);
 assert.equal(SESSION_SECONDS,86400);
 assert.equal(expiresAt,now+86400000);
 assert.ok(!token.includes(env.WEEX_TRADE_APPROVAL_PASSWORD));
 assert.deepEqual(verifyTradeSession(token,now,env),{expiresAt});
 assert.deepEqual(verifyTradeSession(token,expiresAt-1,env),{expiresAt});
 assert.deepEqual(verifyTradeSession(token,now+30*60*1000,env),{expiresAt});
 assert.equal(verifyTradeSession(token,expiresAt,env),null);
 assert.equal(verifyTradeSession(token,now-6000,env),null);
 assert.equal(verifyTradeSession(token,now,{WEEX_TRADE_APPROVAL_PASSWORD:'wrong-password-xxxxxxxxxxx'}),null);
 assert.equal(verifyTradeSession(token,now,{WEEX_TRADE_APPROVAL_PASSWORD:'short'}),null);
 assert.equal(verifyTradeSession(token.slice(0,-1)+(token.endsWith('a')?'b':'a'),now,env),null);
 const altered=token.split('.');altered[2]='f'.repeat(32);
 assert.equal(verifyTradeSession(altered.join('.'),now,env),null);
});

test('browser cookie is host-only, HttpOnly, Secure and SameSite Strict',()=>{
 const session=issueTradeSession(now,env);
 const cookie=cookieForSession(session.token);
 assert.match(cookie,new RegExp('^'+SESSION_COOKIE+'='));
 for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=86400'])
   assert.ok(cookie.includes(flag),flag);
 assert.doesNotMatch(cookie,/Domain=/);
 const token=cookie.split(';')[0];
 assert.deepEqual(authenticatedTradeSession({headers:{cookie:token}},now,env),
  {expiresAt:session.expiresAt});
 assert.equal(authenticatedTradeSession({headers:{cookie:token+'; '+token}},now,env),null);
 assert.equal(authenticatedTradeSession({headers:{cookie:'other=value'}},now,env),null);
 assert.match(cookieForLogout(),/Max-Age=0/);
});

test('login validates password; session status and logout never access WEEX or trade API',async()=>{
 const previous=process.env.WEEX_TRADE_APPROVAL_PASSWORD;
 process.env.WEEX_TRADE_APPROVAL_PASSWORD=env.WEEX_TRADE_APPROVAL_PASSWORD;
 try{
  let res=resp();
  await handler(req('login','incorrect-password-xxxxxxxxxxxx'),res);
  assert.equal(res.statusCode,401);assert.ok(!res.headers['Set-Cookie']);
  res=resp();
  await handler(req('login',env.WEEX_TRADE_APPROVAL_PASSWORD,
   {origin:'https://evil.example'}),res);
  assert.equal(res.statusCode,403);assert.ok(!res.headers['Set-Cookie']);
  res=resp();
  await handler(req('login',env.WEEX_TRADE_APPROVAL_PASSWORD),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.authenticated,true);
  assert.equal(res.body.minutes,1440);
  assert.match(res.body.note,/24-hour/);
  assert.ok(res.headers['Set-Cookie'].includes('HttpOnly'));
  const cookie=res.headers['Set-Cookie'].split(';')[0];
  res=resp();await handler(req('status',undefined,{cookie}),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.authenticated,true);
  res=resp();await handler(req('logout',undefined,{cookie}),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.authenticated,false);
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
  res=resp();await handler({...req('login','x'),method:'GET'},res);
  assert.equal(res.statusCode,405);
 }finally{
  if(previous===undefined)delete process.env.WEEX_TRADE_APPROVAL_PASSWORD;
  else process.env.WEEX_TRADE_APPROVAL_PASSWORD=previous;
 }
});

test('all server trading endpoints require same origin + current signed session',()=>{
 for(const file of ['trade-status','trade-preflight','trade-prepare','trade-confirm','trade-release']){
  const code=readFileSync(new URL('../api/'+file+'.mjs',import.meta.url),'utf8');
  assert.match(code,/requireSameOrigin\(req\)/);
  assert.match(code,/authenticatedTradeSession\(req\)/);
  assert.doesNotMatch(code,/validateHumanPassword\(req\.body\?\.password\)/);
 }
 const execution=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 assert.match(execution,/CONFIRM_REAL_WEEX_ORDER/);
 assert.match(execution,/orderAttempted=true/);
 assert.match(execution,/liveEnabled\(\)/);
 assert.match(execution,/await put\(LOCK,/);
});

test('trade UI does not retain password in localStorage or send it to order endpoints',()=>{
 const html=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 assert.match(html,/id="login"/);
 assert.match(html,/id="logout"/);
 assert.match(html,/post\('\/api\/trade-session',\{action:'login',password:/);
 assert.match(html,/post\('\/api\/trade-session',\{action:'status'\}\)/);
 assert.match(html,/post\('\/api\/trade-session',\{action:'logout'\}\)/);
 assert.doesNotMatch(html,/localStorage|sessionStorage/);
 for(const call of ['trade-status','trade-preflight','trade-prepare','trade-confirm','trade-release']){
  const hits=html.match(new RegExp("post\\('/api/"+call+"',\\{[^}\\n]*\\}","g"))||[];
  if(call==='trade-confirm'){
   assert.match(html,/post\('\/api\/trade-confirm',body\)/);
   assert.match(html,/const body=\{proposal:token,confirmation:'CONFIRM_REAL_WEEX_ORDER'\}/);
   assert.doesNotMatch(html,/body\.password=/);
  }else{
   assert.equal(hits.length,1,call);
   assert.ok(hits.every(h=>!h.includes('password')),call);
  }
 }
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'trade.html'}));
});
