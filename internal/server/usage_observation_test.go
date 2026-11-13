package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"deepaicode2api/internal/deepai"
	"deepaicode2api/internal/store"
)

func TestObservedUsageAcrossProtocols(t *testing.T) {
	for _, protocol := range []string{"chat", "anthropic", "responses-chat", "responses-native"} {
		for _, stream := range []bool{false, true} {
			for _, reported := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/stream=%t/reported=%t", protocol, stream, reported), func(t *testing.T) {
					cacheCost := ""
					if reported {
						cacheCost = `,"prompt_tokens_details":{"cached_tokens":0},"cost":0`
					}
					if protocol == "responses-native" && reported {
						cacheCost = `,"input_tokens_details":{"cached_tokens":0},"cost_details":{"upstream_inference_cost":0}`
					}
					u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
						if protocol == "responses-native" {
							if stream {
								_, _ = io.WriteString(w, "data: "+`{"type":"response.in_progress","response":{"usage":{"input_tokens":10`+cacheCost+`}}}`+"\n\ndata: "+`{"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"output_tokens":5}}}`+"\n\ndata: [DONE]\n\n")
							} else {
								_, _ = io.WriteString(w, `{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":5`+cacheCost+`}}`)
							}
							return
						}
						if stream {
							_, _ = io.WriteString(w, "data: "+`{"choices":[],"usage":{"prompt_tokens":10`+cacheCost+`}}`+"\n\ndata: "+`{"choices":[],"usage":{"completion_tokens":5}}`+"\n\ndata: [DONE]\n\n")
						} else {
							_, _ = io.WriteString(w, `{"id":"c1","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5`+cacheCost+`}}`)
						}
					})
					s, key := newTestServer(t, u)
					model := deepai.Model{ID: "test-model"}
					if protocol == "responses-native" {
						model.API = "openai-responses"
					}
					s.Store.SetModels([]deepai.Model{model}, model.ID)
					path, body := "/v1/chat/completions", fmt.Sprintf(`{"model":"test-model","stream":%t,"messages":[{"role":"user","content":"hi"}]}`, stream)
					if protocol == "anthropic" {
						path, body = "/v1/messages", fmt.Sprintf(`{"model":"test-model","stream":%t,"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`, stream)
					} else if strings.HasPrefix(protocol, "responses") {
						path, body = "/v1/responses", fmt.Sprintf(`{"model":"test-model","stream":%t,"input":"hi"}`, stream)
					}
					rec := do(t, s, http.MethodPost, path, key, body)
					if rec.Code != http.StatusOK {
						t.Fatalf("response %d: %s", rec.Code, rec.Body.String())
					}
					logs := s.Store.Logs(1)
					if len(logs) != 1 || logs[0].TokensIn != 10 || logs[0].TokensOut != 5 || logs[0].CachedReported == nil || *logs[0].CachedReported != reported || logs[0].CostReported == nil || *logs[0].CostReported != reported {
						t.Fatalf("log = %+v", logs)
					}
					trend := s.Store.TrendDays(1)
					d := trend.Days[0]
					if d.Requests != 1 || d.TokensIn != 10 || d.TokensOut != 5 || (d.CacheReportedRequests == 1) != reported || (d.CostReportedRequests == 1) != reported {
						t.Fatalf("trend = %+v", d)
					}
				})
			}
		}
	}
}

func TestTrendAdminAPIAndReset(t *testing.T) {
	s, _ := newTestServer(t, nil)
	s.Store.Record(store.LogEntry{Status: 200}, 0)
	legacy := do(t, s, http.MethodGet, "/admin/api/stats", "", "")
	old := decodeJSON[map[string]any](t, legacy.Body.Bytes())
	if old["total_requests"] != float64(1) || old["days"] != nil {
		t.Fatalf("legacy response changed: %s", legacy.Body.String())
	}
	trend := do(t, s, http.MethodGet, "/admin/api/stats?trend=days&days=7", "", "")
	got := decodeJSON[store.Trend](t, trend.Body.Bytes())
	if trend.Code != 200 || got.Timezone != "UTC" || got.StartedAt == 0 || len(got.Days) != 1 || got.Days[0].Requests != 1 {
		t.Fatalf("trend response: %d %s", trend.Code, trend.Body.String())
	}
	for _, days := range []string{"0", "366", "bad"} {
		rec := do(t, s, http.MethodGet, "/admin/api/stats?trend=days&days="+days, "", "")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("days=%s status=%d", days, rec.Code)
		}
	}
	reset := do(t, s, http.MethodDelete, "/admin/api/stats", "", "")
	if reset.Code != 200 {
		t.Fatalf("reset: %d %s", reset.Code, reset.Body.String())
	}
	reopened, err := store.OpenWithKey(s.Store.Path(), nil)
	if err != nil || reopened.Stats().TotalRequests != 0 || reopened.TrendDays(1).Days[0].Requests != 0 {
		t.Fatalf("reset after reopening: err=%v", err)
	}
}
