import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const html=readFileSync(new URL('../tradingview.html',import.meta.url),'utf8');
const pine=readFileSync(new URL('../tradingview/weex-radar-early-1m.pine',import.meta.url),'utf8');
const market=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');

test('TradingView page is linked, secure and independent from order/push routes',()=>{
 assert.match(main,/href="\/tradingview\.html"/);
 assert.match(main,/tradingview\.html\?symbol=\$\{encodeURIComponent\(s\.symbol\)\}/);
 assert.match(html,/s3\.tradingview\.com\/external-embedding\/embed-widget-advanced-chart\.js/);
 assert.match(html,/https:\/\/www\.tradingview\.com\/chart\//);
 assert.match(html,/WEEX:'\+symbol\+'\.P'/);
 assert.match(html,/Никаких ордеров эта страница не создаёт/);
 assert.doesNotMatch(html,/\/api\/trade-confirm|\/api\/push-dispatch|\/api\/trade-prepare/);
 assert.match(html,/\/api\/signals/);
});
test('TradingView URL uses known symbols and 1m/5m/15m settings only',()=>{
 assert.match(html,/SYMBOLS\.includes\(qs\.get\('symbol'\)\)/);
 assert.match(html,/\['1','5','15'\]\.includes\(qs\.get\('interval'\)\)/);
 assert.match(html,/symbolSelect\.value=selected/);
 const codes=market.match(/const SYMBOLS=\[([^\]]+)\]/)[1].match(/'[^']+'/g).map(v=>v.slice(1,-1));
 for(const code of codes)assert.match(html,new RegExp("'"+code+"'"));
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'tradingview.html'}));
});
test('Pine indicator uses confirmed 15m values and only early alerts',()=>{
 assert.match(pine,/\/\/@version=6/);
 assert.match(pine,/lookahead\s*=\s*barmerge\.lookahead_on/);
 assert.match(pine,/ta\.ema\(close,\s*20\)\[1\]/);
 assert.match(pine,/barstate\.isconfirmed/);
 assert.match(pine,/alertcondition\(earlyLong/);
 assert.match(pine,/alertcondition\(earlyShort/);
 assert.doesNotMatch(pine,/strategy\.entry|strategy\.order|request\.seed/);
});

test('16-market TradingView Early WATCH scanner follows the backend watchlist',()=>{
 const multi=readFileSync(new URL('../tradingview/weex-radar-early-1m-multi16.pine',import.meta.url),'utf8');
 const codes=market.match(/const SYMBOLS=\[([^\]]+)\]/)[1].match(/'[^']+'/g).map(v=>v.slice(1,-1));
 assert.equal(codes.length,16);
 for(const code of codes)assert.ok(multi.includes('"WEEX:'+code+'.P"'),code+' must be tracked');
 assert.equal((multi.match(/"WEEX:[A-Z0-9]+\.P"/g)||[]).length,16);
 assert.match(multi,/\/\/@version=6/);
 assert.match(multi,/dynamic_requests\s*=\s*true/);
 assert.match(multi,/request\.security\(symbol, "1"/);
 assert.match(multi,/request\.security\(symbol, "15"/);
 assert.match(multi,/direction\[1\], close\[1\], time_close\[1\]/);
 assert.match(multi,/lookahead = barmerge\.lookahead_on/);
 assert.match(multi,/ignore_invalid_symbol\s*=\s*true/);
 assert.match(multi,/alert\(/);
 assert.match(multi,/alerted.*array\.new_int\(16/);
 assert.doesNotMatch(multi,/strategy\.entry|strategy\.order|\/api\/trade-confirm|\/api\/trade-prepare/);
 assert.match(html,/href="\/tradingview\/weex-radar-early-1m-multi16\.pine" download/);
 assert.match(html,/fetch\('\/tradingview\/weex-radar-early-1m-multi16\.pine'/);
});
