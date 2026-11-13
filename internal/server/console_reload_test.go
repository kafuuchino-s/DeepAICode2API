package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// HTML 在服务升级后必须重新获取，即使浏览器带着旧入口的 ETag。
// 刷新按钮会使活动查询重新取数，由 frontend/tests/shell.test.tsx 验证。
func TestConsoleHTMLDoesNotReturnCachedEntry(t *testing.T) {
	s, key := newTestServer(t, nil)
	for _, route := range []string{"/", "/login"} {
		first := do(t, s, http.MethodGet, route, key, "")
		req := httptest.NewRequest(http.MethodGet, route, nil)
		req.RemoteAddr = "127.0.0.1:34567"
		req.Header.Set("If-None-Match", first.Header().Get("ETag"))
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" || rec.Body.Len() == 0 {
			t.Errorf("GET %s 带 ETag 应返回最新入口：status=%d cache=%q bytes=%d", route, rec.Code, rec.Header().Get("Cache-Control"), rec.Body.Len())
		}
	}
}
