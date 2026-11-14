package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"deepaicode2api/internal/deepai"
	"deepaicode2api/internal/store"
)

func TestFirstOutputLatencyAcrossProtocols(t *testing.T) {
	for _, protocol := range []string{"chat", "anthropic", "responses-chat", "responses-native"} {
		t.Run(protocol, func(t *testing.T) {
			first := make(chan struct{})
			finish := make(chan struct{})
			var firstOnce, finishOnce sync.Once
			releaseFirst := func() { firstOnce.Do(func() { close(first) }) }
			releaseFinish := func() { finishOnce.Do(func() { close(finish) }) }
			defer releaseFirst()
			defer releaseFinish()

			u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == deepai.ModelBasePath+deepai.PathTheos {
					_, _ = io.WriteString(w, `{}`)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if protocol == "responses-native" {
					_, _ = io.WriteString(w, ": keepalive\n\nevent: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"r1\"}}\n\n")
				} else {
					_, _ = io.WriteString(w, ": keepalive\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n")
				}
				w.(http.Flusher).Flush()
				select {
				case <-first:
				case <-r.Context().Done():
					return
				}
				if protocol == "responses-native" {
					_, _ = io.WriteString(w, "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"START\"}\n\n")
				} else {
					_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"START\"}}]}\n\n")
				}
				w.(http.Flusher).Flush()
				select {
				case <-finish:
				case <-r.Context().Done():
					return
				}
				if protocol == "responses-native" {
					_, _ = io.WriteString(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}}\n\ndata: [DONE]\n\n")
				} else {
					_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\ndata: [DONE]\n\n")
				}
			})
			s, key := newTestServer(t, u)
			model := deepai.Model{ID: "test-model"}
			if protocol == "responses-native" {
				model.API = "openai-responses"
			}
			s.Store.SetModels([]deepai.Model{model}, model.ID)
			gateway := httptest.NewServer(s.Handler())
			defer gateway.Close()

			path, body := "/v1/chat/completions", `{"model":"test-model","stream":true,"messages":[{"role":"user","content":"hi"}]}`
			if protocol == "anthropic" {
				path, body = "/v1/messages", `{"model":"test-model","stream":true,"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`
			} else if strings.HasPrefix(protocol, "responses") {
				path, body = "/v1/responses", `{"model":"test-model","stream":true,"input":"hi"}`
			}
			req, err := http.NewRequest(http.MethodPost, gateway.URL+path, strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+key)
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status = %d", resp.StatusCode)
			}

			// 收到首个心跳或创建事件后仍等待，保证它们不会被记成首字。
			reader := bufio.NewReader(resp.Body)
			if _, err := reader.ReadString('\n'); err != nil {
				t.Fatal(err)
			}
			time.Sleep(50 * time.Millisecond)
			releaseFirst()
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					t.Fatalf("未收到有效输出: %v", err)
				}
				if strings.Contains(line, "START") {
					break
				}
			}
			// 只有首字确实到达客户端后才允许流结束。
			time.Sleep(50 * time.Millisecond)
			releaseFinish()
			if _, err := io.Copy(io.Discard, reader); err != nil {
				t.Fatal(err)
			}
			logs := s.Store.Logs(1)
			if len(logs) != 1 || logs[0].TTFTMS == nil || *logs[0].TTFTMS < 40 || logs[0].LatencyMS-*logs[0].TTFTMS < 40 || logs[0].TokensOut != 5 || logs[0].TokensOutReported == nil || !*logs[0].TokensOutReported {
				t.Fatalf("stream log = %+v", logs)
			}
			admin := do(t, s, http.MethodGet, "/admin/api/logs?limit=1", "", "")
			got := decodeJSON[struct {
				Logs []store.LogEntry `json:"logs"`
			}](t, admin.Body.Bytes())
			if len(got.Logs) != 1 || got.Logs[0].TTFTMS == nil || *got.Logs[0].TTFTMS != *logs[0].TTFTMS {
				t.Fatalf("admin log = %s", admin.Body.String())
			}
		})
	}
}

func TestFirstOutputDetection(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		want      bool
	}{
		{"role", `{"choices":[{"delta":{"role":"assistant"}}]}`, false},
		{"empty", `{"choices":[{"delta":{"content":""}}]}`, false},
		{"usage", `{"choices":[],"usage":{"completion_tokens":3}}`, false},
		{"content", `{"choices":[{"delta":{"content":" "}}]}`, true},
		{"reasoning", `{"choices":[{"delta":{"reasoning_content":"think"}}]}`, true},
		{"refusal", `{"choices":[{"delta":{"refusal":"no"}}]}`, true},
		{"tool metadata", `{"choices":[{"delta":{"tool_calls":[{"id":"call_1","index":0}]}}]}`, false},
		{"tool name", `{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search"}}]}}]}`, true},
		{"tool args", `{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}]}`, true},
		{"legacy function", `{"choices":[{"delta":{"function_call":{"name":"search"}}}]}`, true},
		{"later choice", `{"choices":[{"delta":{"role":"assistant"}},{"delta":{"content":"x"}}]}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var chunk map[string]any
			if err := json.Unmarshal([]byte(tc.raw), &chunk); err != nil {
				t.Fatal(err)
			}
			if got := chatChunkHasOutput(chunk); got != tc.want {
				t.Fatalf("chatChunkHasOutput = %t, want %t", got, tc.want)
			}
		})
	}
	for _, tc := range []struct {
		typ, delta string
		want       bool
	}{
		{"response.created", "", false},
		{"response.completed", "", false},
		{"response.output_text.delta", "", false},
		{"response.output_text.delta", "word", true},
		{"response.reasoning_summary_text.delta", "think", true},
		{"response.function_call_arguments.delta", "{", true},
	} {
		t.Run(tc.typ+fmt.Sprint(tc.want), func(t *testing.T) {
			if got := responsesEventHasOutput(map[string]any{"type": tc.typ, "delta": tc.delta}); got != tc.want {
				t.Fatalf("responsesEventHasOutput = %t, want %t", got, tc.want)
			}
		})
	}
	for _, tc := range []struct {
		name string
		item map[string]any
		want bool
	}{
		{"message metadata", map[string]any{"type": "message", "id": "msg_1"}, false},
		{"tool metadata", map[string]any{"type": "function_call", "id": "call_1"}, false},
		{"tool name", map[string]any{"type": "function_call", "name": "search"}, true},
		{"tool arguments", map[string]any{"type": "function_call", "arguments": "{}"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := responsesEventHasOutput(map[string]any{"type": "response.output_item.added", "item": tc.item}); got != tc.want {
				t.Fatalf("responsesEventHasOutput = %t, want %t", got, tc.want)
			}
		})
	}
}

func TestFirstOutputNonTextAcrossProtocols(t *testing.T) {
	for _, protocol := range []string{"chat", "anthropic", "responses-chat", "responses-native"} {
		for _, signal := range []string{"reasoning", "tool"} {
			t.Run(protocol+"/"+signal, func(t *testing.T) {
				upstream := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == deepai.ModelBasePath+deepai.PathTheos {
						_, _ = io.WriteString(w, `{}`)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if protocol == "responses-native" {
						if signal == "reasoning" {
							_, _ = io.WriteString(w, "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"START\"}\n\n")
						} else {
							_, _ = io.WriteString(w, "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"name\":\"START\",\"arguments\":\"\"}}\n\n")
						}
					} else if signal == "reasoning" {
						_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"START\"}}]}\n\n")
					} else {
						_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"START\",\"arguments\":\"{}\"}}]}}]}\n\n")
					}
					_, _ = io.WriteString(w, "data: [DONE]\n\n")
				})
				s, key := newTestServer(t, upstream)
				model := deepai.Model{ID: "test-model"}
				if protocol == "responses-native" {
					model.API = "openai-responses"
				}
				s.Store.SetModels([]deepai.Model{model}, model.ID)
				path, body := "/v1/chat/completions", `{"model":"test-model","stream":true,"messages":[{"role":"user","content":"hi"}]}`
				if protocol == "anthropic" {
					path, body = "/v1/messages", `{"model":"test-model","stream":true,"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`
				} else if strings.HasPrefix(protocol, "responses") {
					path, body = "/v1/responses", `{"model":"test-model","stream":true,"input":"hi"}`
				}
				res := do(t, s, http.MethodPost, path, key, body)
				logs := s.Store.Logs(1)
				if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "START") || len(logs) != 1 || logs[0].TTFTMS == nil {
					t.Fatalf("status=%d, body=%s, logs=%+v", res.Code, res.Body.String(), logs)
				}
			})
		}
	}
}

func TestFirstOutputUnavailableAndZeroJSON(t *testing.T) {
	s, _ := newTestServer(t, nil)
	for _, stream := range []bool{false, true} {
		rl := s.newReqLog("", nil, "m", "chat", stream, time.Now(), 0)
		rl.done(0, Usage{}, nil)
		entry := s.Store.Logs(1)[0]
		if entry.TTFTMS != nil {
			t.Fatalf("stream=%t: no output must have unknown TTFT: %+v", stream, entry)
		}
		raw, err := json.Marshal(entry)
		if err != nil || strings.Contains(string(raw), `"ttft_ms"`) {
			t.Fatalf("missing TTFT JSON = %s, err=%v", raw, err)
		}
	}
	zero := int64(0)
	raw, err := json.Marshal(store.LogEntry{TTFTMS: &zero})
	if err != nil || !strings.Contains(string(raw), `"ttft_ms":0`) {
		t.Fatalf("zero TTFT JSON = %s, err=%v", raw, err)
	}
}
