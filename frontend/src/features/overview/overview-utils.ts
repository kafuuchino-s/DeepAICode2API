export type TrendDay = {
  date: string;
  partial: boolean;
  requests: number;
  failed: number;
  client_gone: number;
  tokens_in: number;
  tokens_out: number;
  input_reported_requests: number;
  output_reported_requests: number;
  cached_tokens: number;
  cache_reported_requests: number;
  cache_paired_requests: number;
  cache_paired_tokens: number;
  cache_paired_input_tokens: number;
  cost: number;
  cost_reported_requests: number;
  gateway_cost?: number;
  gateway_cost_reported_requests?: number;
};
export type Trend = { started_at: number; generated_at: number; timezone: string; days: TrendDay[] };

export function summarize(days: TrendDay[]) {
  return days.reduce((a, d) => ({
    requests: a.requests + d.requests,
    failed: a.failed + d.failed,
    clientGone: a.clientGone + d.client_gone,
    tokensIn: a.tokensIn + d.tokens_in,
    tokensOut: a.tokensOut + d.tokens_out,
    inputReported: a.inputReported + d.input_reported_requests,
    outputReported: a.outputReported + d.output_reported_requests,
    cachedTokens: a.cachedTokens + d.cached_tokens,
    cacheReported: a.cacheReported + d.cache_reported_requests,
    paired: a.paired + d.cache_paired_requests,
    pairedCached: a.pairedCached + d.cache_paired_tokens,
    pairedInput: a.pairedInput + d.cache_paired_input_tokens,
    cost: a.cost + d.cost,
    costReported: a.costReported + d.cost_reported_requests,
    gatewayCost: a.gatewayCost + (d.gateway_cost ?? 0),
    gatewayCostReported: a.gatewayCostReported + (d.gateway_cost_reported_requests ?? 0),
  }), { requests: 0, failed: 0, clientGone: 0, tokensIn: 0, tokensOut: 0, inputReported: 0, outputReported: 0, cachedTokens: 0, cacheReported: 0, paired: 0, pairedCached: 0, pairedInput: 0, cost: 0, costReported: 0, gatewayCost: 0, gatewayCostReported: 0 });
}

// A reported zero is a value; zero samples means the source supplied no value.
export function reportedValue(value: number, samples: number, format: (value: number) => string): string {
  return samples > 0 ? format(value) : '—';
}

export function cacheRate(cached: number, input: number, samples: number): string {
  return samples > 0 && input > 0 ? `${(cached / input * 100).toFixed(1)}%` : '—';
}
