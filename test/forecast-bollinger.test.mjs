import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastBollinger} from '../lib/forecast-bollinger.mjs';

test('BB 20/2 flat price has zero band width',()=>{
 const band=forecastBollinger(Array(25).fill(100));
 assert.deepEqual(band,{
  period:20,deviation:2,middle:100,upper:100,lower:100,
  widthPercent:0,position:'UPPER_HALF'
 });
});
test('BB 20/2 bounds are symmetric around SMA of 20 latest closed prices',()=>{
 const closes=Array.from({length:30},(_,i)=>100+i);
 const band=forecastBollinger(closes);
 assert.equal(band.middle,119.5);
 assert.ok(band.upper>band.middle&&band.lower<band.middle);
 assert.ok(Math.abs((band.upper+band.lower)/2-band.middle)<0.000001);
 assert.ok(band.widthPercent>0);
});
test('BB never gives a trade decision or reversal prediction',()=>{
 const band=forecastBollinger([...Array(19).fill(100),120]);
 assert.equal(band.position,'ABOVE_UPPER');
 assert.equal(Object.hasOwn(band,'direction'),false);
 assert.equal(Object.hasOwn(band,'enter'),false);
 assert.equal(Object.hasOwn(band,'stop'),false);
});
test('BB rejects insufficient or invalid data',()=>{
 assert.equal(forecastBollinger(Array(19).fill(100)),null);
 assert.equal(forecastBollinger([...Array(19).fill(100),NaN]),null);
 assert.equal(forecastBollinger(Array(20).fill(100),20,0),null);
});
