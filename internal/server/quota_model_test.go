package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"deepaicode2api/internal/deepai"
	"deepaicode2api/internal/store"
)

func TestModelRequiresPaidQuota(t *testing.T) {
	for _, tc := range []struct {
		name  string
		model deepai.Model
		want  bool
	}{
		{"free", deepai.Model{TheosPerRequest: "0"}, false},
		{"free with decimals", deepai.Model{TheosPerRequest: "0.000"}, false},
		{"per request", deepai.Model{TheosPerRequest: "0.001"}, true},
		{"per second", deepai.Model{TheosPerRequest: "0", TheosPerSecond: map[string]string{"fast": "0.1"}}, true},
		{"unknown", deepai.Model{}, false},
		{"malformed", deepai.Model{TheosPerRequest: "unknown"}, false},
		{"premier without prices", deepai.Model{Premier: true}, true},
		{"explicit free premier", deepai.Model{Premier: true, TheosPerRequest: "0"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelRequiresPaidQuota(tc.model); got != tc.want {
				t.Fatalf("modelRequiresPaidQuota(%+v) = %v, want %v", tc.model, got, tc.want)
			}
		})
	}
}

// TestQuotaExhaustionStillAllowsFreeModels exercises the actual protocol routes:
// an account that ran out of paid Theos can still serve free models, and a
// successful free request must not erase the paid quota recovery time.
func TestQuotaExhaustionStillAllowsFreeModels(t *testing.T) {
	var modelCalls atomic.Int32
	u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case deepai.ModelBasePath + deepai.PathChat:
			modelCalls.Add(1)
			_, _ = io.WriteString(w, okChatResponse)
		case deepai.ModelBasePath + deepai.PathResponses:
			modelCalls.Add(1)
			_, _ = io.WriteString(w, `{"id":"resp-test","object":"response","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`)
		default:
			_, _ = io.WriteString(w, `{}`)
		}
	})
	s, key := newTestServer(t, u)
	s.Store.SetModels([]deepai.Model{
		{ID: "free-chat", TheosPerRequest: "0"},
		{ID: "free-responses", API: "openai-responses", TheosPerRequest: "0"},
		{ID: "paid-chat", TheosPerRequest: "10"},
		{ID: "unknown-price"},
	}, "free-chat")
	s.Store.UpdateSettings(func(st *store.Settings) { st.ModelAliases = map[string]string{"free-alias": "free-chat"} })
	until := time.Now().Add(time.Hour).Unix()
	s.Store.UpdateAccount("acc-1", func(a *deepai.Account) { a.QuotaUntil = until })

	for _, tc := range []struct{ name, path, body string }{
		{"chat", "/v1/chat/completions", `{"model":"free-chat","messages":[{"role":"user","content":"hi"}]}`},
		{"free alias", "/v1/chat/completions", `{"model":"free-alias","messages":[{"role":"user","content":"hi"}]}`},
		{"responses translated", "/v1/responses", `{"model":"free-chat","input":"hi"}`},
		{"responses native", "/v1/responses", `{"model":"free-responses","input":"hi"}`},
		{"anthropic", "/v1/messages", `{"model":"free-chat","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`},
		{"unknown price", "/v1/chat/completions", `{"model":"unknown-price","messages":[{"role":"user","content":"hi"}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, s, http.MethodPost, tc.path, key, tc.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("免费或未知价格的模型应能尝试现有账号，实际 %d: %s", rec.Code, rec.Body.String())
			}
			if got := s.Store.Account("acc-1").QuotaUntil; got != until {
				t.Fatalf("免费或未知价格模型成功不能清除付费额度限制: got=%d want=%d", got, until)
			}
		})
	}

	before := modelCalls.Load()
	rec := do(t, s, http.MethodPost, "/v1/chat/completions", key, `{"model":"paid-chat","messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code == http.StatusOK || modelCalls.Load() != before {
		t.Fatalf("已知付费模型应在恢复前跳过耗尽账号，状态=%d，新增上游调用=%d", rec.Code, modelCalls.Load()-before)
	}

	s.Store.UpdateAccount("acc-1", func(a *deepai.Account) { a.QuotaUntil = time.Now().Add(-time.Second).Unix() })
	rec = do(t, s, http.MethodPost, "/v1/chat/completions", key, `{"model":"paid-chat","messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("额度到期后付费模型应恢复调度，实际 %d: %s", rec.Code, rec.Body.String())
	}
	if got := s.Store.Account("acc-1").QuotaUntil; got != 0 {
		t.Fatalf("付费请求成功应清除过期的额度标记，实际 %d", got)
	}
}

// An unknown-priced model is allowed to try an exhausted account, but after
// the upstream rejects it that account must not be retried in the same request.
func TestUnknownPriceQuotaRejectionDoesNotRepeatAccount(t *testing.T) {
	var calls atomic.Int32
	u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == deepai.ModelBasePath+deepai.PathChat {
			calls.Add(1)
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "theos_exhausted"}})
			return
		}
		_, _ = io.WriteString(w, `{}`)
	})
	s, key := newTestServer(t, u)
	s.Store.SetModels([]deepai.Model{{ID: "unknown-price"}}, "unknown-price")
	s.Store.UpdateAccount("acc-1", func(a *deepai.Account) { a.QuotaUntil = time.Now().Add(time.Hour).Unix() })
	rec := do(t, s, http.MethodPost, "/v1/chat/completions", key, `{"model":"unknown-price","messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "theos_exhausted") {
		t.Fatalf("应向客户端返回实际额度错误，实际 %d: %s", rec.Code, rec.Body.String())
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("同一请求中同一账号只能尝试一次，实际 %d 次", got)
	}
}
