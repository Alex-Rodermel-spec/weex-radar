// Explicit owner-requested moderate MANUAL-ENTRY experiment.
// No automatic trading. Account/position limits, WEEX-only live execution,
// passkey confirmation, same-origin CSRF, attached SL/TP, and kill switches
// remain independent and MUST NOT be modified by this profile.
export const ACTIVE_STRATEGY=Object.freeze({
 name:'MODERATE_MANUAL',
 stopAtr:1.2,
 takeAtr:3.0,
 minNetRR:1.3,
 phase:'EXPERIMENTAL',
 evidence:'Historical selection sensitivity over ~2d does not establish profitability.'
});
