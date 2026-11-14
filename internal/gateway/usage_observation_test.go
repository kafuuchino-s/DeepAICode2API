package gateway

import (
	"encoding/json"
	"math"
	"testing"
)

func TestUsageObservationMissingZeroAndFormats(t *testing.T) {
	cases := []struct {
		name string
		v    any
		want UsageObservation
	}{
		{"missing", map[string]any{"prompt_tokens": float64(10)}, UsageObservation{PromptTokens: 10, PromptReported: true}},
		{"explicit-zero", map[string]any{"input_tokens": float64(0), "output_tokens": float64(0), "input_tokens_details": map[string]any{"cached_tokens": float64(0)}, "cost": float64(0)}, UsageObservation{PromptReported: true, CompletionReported: true, CachedReported: true, CostReported: true}},
		{"chat", map[string]any{"prompt_tokens": float64(20), "completion_tokens": float64(3), "prompt_tokens_details": map[string]any{"cached_tokens": float64(7)}, "cost_details": map[string]any{"upstream_inference_cost": 0.25}}, UsageObservation{PromptTokens: 20, CompletionTokens: 3, CachedTokens: 7, Cost: 0.25, PromptReported: true, CompletionReported: true, CachedReported: true, CostReported: true}},
		{"alternate", map[string]any{"prompt_tokens": 0, "input_tokens": json.Number("15"), "cache_read_input_tokens": json.Number("5"), "cost": nil}, UsageObservation{PromptTokens: 15, CachedTokens: 5, PromptReported: true, CachedReported: true}},
		{"gateway-only", map[string]any{"gateway_cost": json.Number("8.325e-06")}, UsageObservation{GatewayCost: 0.000008325, GatewayCostReported: true}},
		{"gateway-zero", map[string]any{"gateway_cost": 0}, UsageObservation{GatewayCostReported: true}},
		{"both-costs", map[string]any{"cost": 0.25, "gateway_cost": 0.5}, UsageObservation{Cost: 0.25, CostReported: true, GatewayCost: 0.5, GatewayCostReported: true}},
		{"invalid", map[string]any{"prompt_tokens": -1, "completion_tokens": 1.5, "cache_read_input_tokens": "0", "cost": math.NaN(), "gateway_cost": -1}, UsageObservation{}},
		{"gateway-invalid-number", map[string]any{"gateway_cost": math.Inf(1)}, UsageObservation{}},
		{"null", nil, UsageObservation{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var obs UsageObservation
			obs.Observe(tc.v)
			if obs != tc.want {
				t.Fatalf("observation = %+v, want %+v", obs, tc.want)
			}
		})
	}
}

func TestUsageObservationMergesFrames(t *testing.T) {
	var obs UsageObservation
	obs.Observe(map[string]any{"prompt_tokens": 100, "prompt_tokens_details": map[string]any{"cached_tokens": 80}, "cost": 0.2, "gateway_cost": 0.000008325})
	obs.Observe(map[string]any{"completion_tokens": 12})
	if obs.PromptTokens != 100 || obs.CompletionTokens != 12 || obs.CachedTokens != 80 || obs.Cost != 0.2 || obs.GatewayCost != 0.000008325 || !obs.CachedReported || !obs.CostReported || !obs.GatewayCostReported {
		t.Fatalf("partial frame discarded earlier usage: %+v", obs)
	}
	obs.Observe(map[string]any{"prompt_tokens_details": map[string]any{"cached_tokens": 0}, "cost": 0, "gateway_cost": 0})
	if obs.CachedTokens != 0 || obs.Cost != 0 || obs.GatewayCost != 0 || !obs.CachedReported || !obs.CostReported || !obs.GatewayCostReported {
		t.Fatalf("explicit zero did not replace earlier value: %+v", obs)
	}
}
