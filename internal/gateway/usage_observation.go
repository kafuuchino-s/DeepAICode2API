package gateway

import (
	"encoding/json"
	"math"
)

// UsageObservation 与客户端协议的 Usage 分开：旧客户端仍得到原来的数值，
// 统计则必须区分上游明确给出的零和未提供的字段。
type UsageObservation struct {
	PromptTokens, CompletionTokens, CachedTokens int
	Cost, GatewayCost                            float64
	PromptReported, CompletionReported           bool
	CachedReported, CostReported                 bool
	GatewayCostReported                          bool
}

// Observe 合并一帧上游用量。流式响应可能把不同字段放在不同帧；只替换
// 本帧确实上报的值，避免后续缺字段的帧把已观察到的值清零。
func (o *UsageObservation) Observe(v any) {
	m, ok := v.(map[string]any)
	if !ok {
		return
	}
	if n, ok := observedInt(m["prompt_tokens"], m["input_tokens"]); ok {
		o.PromptTokens, o.PromptReported = n, true
	}
	if n, ok := observedInt(m["completion_tokens"], m["output_tokens"]); ok {
		o.CompletionTokens, o.CompletionReported = n, true
	}
	var cache []any
	for _, key := range []string{"prompt_tokens_details", "input_tokens_details"} {
		if details, ok := m[key].(map[string]any); ok {
			cache = append(cache, details["cached_tokens"])
		}
	}
	cache = append(cache, m["cache_read_input_tokens"])
	if n, ok := observedInt(cache...); ok {
		o.CachedTokens, o.CachedReported = n, true
	}
	cost := []any{m["cost"]}
	if details, ok := m["cost_details"].(map[string]any); ok {
		cost = append(cost, details["upstream_inference_cost"])
	}
	if n, ok := observedNumber(cost...); ok {
		o.Cost, o.CostReported = n, true
	}
	// gateway_cost 的单位和扣费含义尚未确认，不能混入原有费用。
	if n, ok := observedNumber(m["gateway_cost"]); ok {
		o.GatewayCost, o.GatewayCostReported = n, true
	}
}

// 与现有 ParseUsage 一样优先采用非零备用字段；所有有效候选都是零时
// 仍返回已上报。类型错误、负数和非有限值不计作有效上报。
func observedNumber(values ...any) (float64, bool) {
	found := false
	for _, value := range values {
		var n float64
		switch v := value.(type) {
		case float64:
			n = v
		case int:
			n = float64(v)
		case json.Number:
			var err error
			n, err = v.Float64()
			if err != nil {
				continue
			}
		default:
			continue
		}
		if n < 0 || math.IsNaN(n) || math.IsInf(n, 0) {
			continue
		}
		found = true
		if n != 0 {
			return n, true
		}
	}
	return 0, found
}

func observedInt(values ...any) (int, bool) {
	// 整数需要逐个校验，不能让无效的小数阻止后面的有效备用字段。
	found := false
	for _, value := range values {
		n, ok := observedNumber(value)
		if !ok || n != math.Trunc(n) || n >= float64(math.MaxInt) {
			continue
		}
		found = true
		if n != 0 {
			return int(n), true
		}
	}
	return 0, found
}
