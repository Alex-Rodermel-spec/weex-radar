// Active, deliberately narrow sideway-market entry gate for CONFIRMED 5m
// breakouts only. The broader structure detector remains SHADOW and still
// reports false breaks/retests without suppressing alerts.
// This is a heuristic, NOT validated for profitability or predictive accuracy.
export const MAX_WEAK_BREAKOUT_ATR=0.35;
export const MIN_CONVINCING_VOLUME_RATIO=1.20;

export function checkSidewaysEntry(structure){
 if(structure?.mode!=='SHADOW'||typeof structure.flat!=='boolean'||
    !structure.context)return {evaluated:false,blocked:false,
      reason:null,mode:'ACTIVE_5M_FLAT_ONLY'};
 const breakoutAtr=Number(structure.breakoutAtr);
 const volumeRatio=structure.context.volumeRatio;
 const valid=Number.isFinite(breakoutAtr)&&
  (volumeRatio===null||Number.isFinite(volumeRatio));
 if(!valid)return {evaluated:false,blocked:false,
   reason:null,mode:'ACTIVE_5M_FLAT_ONLY'};
 // A tight preceding sideways range alone does not invalidate a strong new
 // breakout: suppress only weak extensions WITH non-confirming volume, and
 // never suppress an actual confirmed retest.
 const blocked=structure.flat===true &&
  structure.retestConfirmed!==true &&
  breakoutAtr>0&&breakoutAtr<=MAX_WEAK_BREAKOUT_ATR &&
  volumeRatio!==null&&volumeRatio<MIN_CONVINCING_VOLUME_RATIO;
 return {
  mode:'ACTIVE_5M_FLAT_ONLY',evaluated:true,blocked,
  reason:blocked?'Боковик + слабый пробой без подтверждения объёма — вход пропущен':null,
  criteria:{
   sideways:structure.flat,
   breakoutAtr:Math.round(breakoutAtr*100)/100,
   volumeRatio,
   retestConfirmed:structure.retestConfirmed===true
  }
 };
}
