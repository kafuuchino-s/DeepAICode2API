package server

import (
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// 从真实构建入口取脚本和样式路径，逐一经 HTTP 访问；覆盖 embed 和路由接线。
func TestConsoleBuildAssetsResolve(t *testing.T) {
	s, key := newTestServer(t, nil)
	entry := do(t, s, http.MethodGet, "/", key, "")
	assets := regexp.MustCompile(`(?:src|href)="(/assets/[^"]+)"`).FindAllStringSubmatch(entry.Body.String(), -1)
	seenJS, seenCSS := false, false
	for _, match := range assets {
		route := match[1]
		rec := do(t, s, http.MethodGet, route, key, "")
		if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
			t.Errorf("GET %s: status=%d bytes=%d", route, rec.Code, rec.Body.Len())
			continue
		}
		if rec.Header().Get("ETag") == "" {
			t.Errorf("GET %s 缺少 ETag", route)
		}
		if strings.HasSuffix(route, ".js") {
			seenJS = true
			if !strings.Contains(rec.Header().Get("Content-Type"), "text/javascript") {
				t.Errorf("%s MIME = %q", route, rec.Header().Get("Content-Type"))
			}
		}
		if strings.HasSuffix(route, ".css") {
			seenCSS = true
			if !strings.Contains(rec.Header().Get("Content-Type"), "text/css") {
				t.Errorf("%s MIME = %q", route, rec.Header().Get("Content-Type"))
			}
		}
	}
	if !seenJS || !seenCSS {
		t.Fatalf("构建入口需同时引用 JS 和 CSS，找到 JS=%v CSS=%v", seenJS, seenCSS)
	}
}
