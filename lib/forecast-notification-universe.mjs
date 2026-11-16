// Notifications focus only: keep ALL 32 markets in the scanner, dashboards,
// and V110 research, but reserve the 1m/5m/10m ntfy FORECAST channel for
// 16 crypto + 3 metals. This is NOT a trading-performance improvement claim.
// The original 16-market manual-trade allowlist remains entirely independent.
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';

const DELIVERY_GROUPS=new Set([
 'MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO','METALS'
]);
const all=profileSymbols();
const core=all.filter(symbol=>
 DELIVERY_GROUPS.has(marketForecastProfile(symbol)?.group));
const excluded=all.filter(symbol=>!core.includes(symbol));
if(all.length!==32||new Set(all).size!==32||core.length!==19||
   excluded.length!==13)throw Error('FORECAST_NOTIFICATION_UNIVERSE_NOT_32_19_13');
const CORE=new Set(core);
export const FORECAST_NOTIFICATION_UNIVERSE=Object.freeze({
 version:'2026-11-16-crypto16-metals3-notification-focus-v1',
 scanMarkets:32,notificationMarkets:19,researchOnlyMarkets:13,
 excludedGroups:Object.freeze(['FX_DERIVED','EQUITY_DERIVED']),
 change:'SEPARATE_NTFY_FORECAST_ONLY',
 confirmed5mUnchanged:true,earlyResearch32Unchanged:true,
 originalManualTradeUniverseUnchanged:true,noOrders:true,
 noClaimOfAccuracyImprovement:true,
 metrics:'Observed 15m historical signed-close results are descriptive, not causal or fee-adjusted.'
});
export const PRIMARY_FORECAST_NOTIFICATION_SYMBOLS=Object.freeze(core);
export const RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS=Object.freeze(excluded);
export function forecastNotificationAllowed(symbol){
 return typeof symbol==='string'&&CORE.has(symbol);
}
