import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import handler, {constantTimeSecretMatch,signedReadHeaders,checkWeexReadOnly,WEEX_ACCOUNT_CONFIG_PATH} from '../api/weex-connection-check.mjs';
const credentials = {key:'weex_example',secret:'test-secret-key',passphrase:'test-passphrase'};
const timestamp = 1794029800000;
function response() {
  return {headers:{},code:200,body:undefined,setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.body=v;return this}};
}
test('signs exactly the WEEX V3 private GET request',()=>{
  const headers = signedReadHeaders(credentials,timestamp);
  const expected = createHmac('sha256','test-secret-key')
    .update(String(timestamp) + 'GET' + WEEX_ACCOUNT_CONFIG_PATH).digest('base64');
  assert.equal(headers['ACCESS-SIGN'],expected);
  assert.equal(headers['ACCESS-PASSPHRASE'],'test-passphrase');
});
test('constant time secret match handles invalid and mismatched input',()=>{
  assert.equal(constantTimeSecretMatch('cron-key','cron-key'),true);
  assert.equal(constantTimeSecretMatch('cron-key','bad'),false);
  assert.equal(constantTimeSecretMatch(null,'cron-key'),false);
});
test('signed accountConfig request validates response, never submits orders',async()=>{
  const requests=[];
  const fetchImpl=async(url,opts)=>{
    requests.push({url,method:opts.method});
    assert.equal(opts.headers['ACCESS-KEY'],credentials.key);
    return {ok:true,json:async()=>({canTrade:true,canWithdraw:false,dualSidePosition:true})};
  };
  assert.equal(await checkWeexReadOnly(credentials,fetchImpl,timestamp),true);
  assert.deepEqual(requests,[{url:'https://api-contract.weex.com'+WEEX_ACCOUNT_CONFIG_PATH,method:'GET'}]);
});
test('rejects invalid upstream responses', async()=>{
  assert.equal(await checkWeexReadOnly(credentials,async()=>({ok:false}),timestamp),false);
  assert.equal(await checkWeexReadOnly(credentials,async()=>({ok:true,json:async()=>({balance:'1000000'})}),timestamp),false);
});
test('diagnostics route does not call WEEX when unauthorized',async()=>{
  const old = process.env.PUSH_CRON_KEY;
  process.env.PUSH_CRON_KEY='test-key';
  try{
    const res=response();
    await handler({method:'POST',headers:{'x-radar-cron-key':'invalid'}},res);
    assert.equal(res.code,401);
    assert.equal(res.body.error,'Unauthorized');
    assert.equal(res.headers['Cache-Control'],'private, no-store');
  } finally {if(old===undefined)delete process.env.PUSH_CRON_KEY;else process.env.PUSH_CRON_KEY=old;}
});
