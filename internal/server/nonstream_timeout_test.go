package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"deepaicode2api/internal/store"
)

type deadlineRoundTripper func(*http.Request) (*http.Response, error)

func (f deadlineRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

// 三种非流式协议都应使用配置的整体请求超时，而不是在 90 秒提前结束。
func TestNonStreamUsesConfiguredRequestTimeout(t *testing.T) {
	cases := []struct {
		name, path, body string
	}{
		{"chat", "/v1/chat/completions", `{"model":"m","messages":[{"role":"user","content":"hi"}]}`},
		{"responses", "/v1/responses", `{"model":"m","input":"hi"}`},
		{"messages", "/v1/messages", `{"model":"m","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`},
	}
	for _, tc := range cases {
		for _, timeout := range []int{600, 30} {
			t.Run(fmt.Sprintf("%s/%ds", tc.name, timeout), func(t *testing.T) {
				s, key := newTestServer(t, nil)
				s.Store.UpdateSettings(func(st *store.Settings) { st.RequestTimeout = timeout })
				var remaining time.Duration
				s.Up.HTTP.Transport = deadlineRoundTripper(func(r *http.Request) (*http.Response, error) {
					body := `{"enabled":true}`
					if strings.HasSuffix(r.URL.Path, "/chat/completions") {
						deadline, ok := r.Context().Deadline()
						if !ok {
							t.Fatal("推理请求应有整体超时")
						}
						remaining = time.Until(deadline)
						body = `{"id":"test","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`
					}
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
				})
				rec := do(t, s, http.MethodPost, tc.path, key, tc.body)
				if rec.Code != http.StatusOK {
					t.Fatalf("请求失败：status=%d body=%s", rec.Code, rec.Body.String())
				}
				want := time.Duration(timeout) * time.Second
				if remaining < want-time.Second || remaining > want {
					t.Fatalf("上游请求剩余预算 = %v，期望约 %v", remaining, want)
				}
			})
		}
	}
}
