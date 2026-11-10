// Bollinger Bands observation for market forecasts only.
// This module never selects trades, sets SL/TP, or predicts a reversal.
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const rounded = value => Number(value.toFixed(8));

export function forecastBollinger(closes, period = 20, deviation = 2) {
 if (!Array.isArray(closes) || !Number.isInteger(period) || period < 2 ||
     !Number.isFinite(deviation) || deviation <= 0 || closes.length < period) return null;
 const sample = closes.slice(-period);
 if (!sample.every(finitePositive)) return null;
 const mean = sample.reduce((sum, price) => sum + price, 0) / period;
 const variance = sample.reduce((sum, price) => sum + (price - mean) ** 2, 0) / period;
 const distance = deviation * Math.sqrt(variance);
 const upper = mean + distance, lower = mean - distance, price = sample.at(-1);
 const widthPercent = 100 * (upper - lower) / mean;
 // A price touching a band does NOT imply that it must reverse.
 const position = price > upper ? 'ABOVE_UPPER' : price < lower ? 'BELOW_LOWER' :
   price >= mean ? 'UPPER_HALF' : 'LOWER_HALF';
 return {period, deviation, middle: rounded(mean), upper: rounded(upper),
   lower: rounded(lower), widthPercent: Number(widthPercent.toFixed(3)), position};
}
