import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('public forecast page and forecast ntfy keep TP/SL out of research-only outputs',()=>{
 const standalone=read('../forecast.html');
 const forecastNtfy=read('../lib/forecast-ntfy.mjs');
 assert.doesNotMatch(standalone,/\bTP\b|\bSL\b/);
 const messageSource=forecastNtfy.split('export function forecastMessage(d){')[1]
  .split('async function history(')[0];
 assert.ok(messageSource);
 assert.doesNotMatch(messageSource,/\bTP\b|\bSL\b|stopLoss|takeProfit/);
 assert.match(messageSource,/НЕ сигнал входа/);
});
test('journal defaults to direction & timing, without displayed TP/SL performance',()=>{
 const site=read('../history.html');
 assert.doesNotMatch(site,/<(?:small|th)>[^<]*(?:TP|SL|Достигли|Доля TP)[^<]*<\/(?:small|th)>/);
 assert.doesNotMatch(site,/id="(?:tp|sl|rate|average|market|direction|shadow)"/);
 assert.match(site,/id="forecast5"/);
 assert.match(site,/id="forecast10"/);
 assert.match(site,/id="forecast15"/);
 assert.match(site,/id="confirmedSaved"/);
 assert.match(site,/confirmedAuditDirection/);
 assert.ok(site.indexOf('Прогнозист — фактическое')<site.indexOf('Подтверждённые LONG'));
 assert.ok(site.indexOf('Подтверждённые LONG')<site.indexOf('Ранние предупреждения'));
 const match=site.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new Script(match[1]));
});
test('change leaves protective trade levels in existing confirmed alerts untouched',()=>{
 const source=read('../lib/signal-quality.mjs');
 assert.match(source,/stop/);
 assert.match(source,/take/);
 const writer=read('../lib/journal-route.mjs');
 assert.match(writer,/mergeJournal/);
 assert.match(writer,/mergeForecastArchive/);
 assert.match(writer,/mergeConfirmedDirectionArchive/);
});
