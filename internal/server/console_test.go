package server

import (
	"net/http"
	"strings"
	"testing"
)

// 控制台和登录页是同一个构建入口；CSP 不允许内联脚本、样式或跨域连接。
func TestConsoleEntryRoutes(t *testing.T) {
	s, key := newTestServer(t, nil)
	var index string
	for _, route := range []string{"/", "/login"} {
		rec := do(t, s, http.MethodGet, route, key, "")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("GET %s: status=%d Content-Type=%q", route, rec.Code, rec.Header().Get("Content-Type"))
		}
		page := rec.Body.String()
		if !strings.Contains(page, `id="root"`) || !strings.Contains(page, `/assets/`) {
			t.Fatalf("GET %s 未返回构建后的控制台入口", route)
		}
		if strings.Contains(page, "/js/app.js") || strings.Contains(page, "<style>") || strings.Contains(page, "<script>") {
			t.Errorf("GET %s 引用了旧控制台或内联资源", route)
		}
		csp := rec.Header().Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s CSP 缺少 %q: %s", route, want, csp)
			}
		}
		if strings.Contains(csp, "'unsafe-inline'") || strings.Contains(csp, "'unsafe-eval'") {
			t.Errorf("%s CSP 不应允许不安全的内联代码: %s", route, csp)
		}
		if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Errorf("%s 缺少安全响应头", route)
		}
		if index != "" && index != page {
			t.Error("/ 与 /login 应返回同一构建入口")
		}
		index = page
	}
}
