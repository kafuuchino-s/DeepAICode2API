package server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// 静态资源可用 ETag 重校验；过期版本必须重新下载。
func TestConsoleAssetConditionalGET(t *testing.T) {
	s, key := newTestServer(t, nil)
	entry := do(t, s, http.MethodGet, "/", key, "")
	match := regexp.MustCompile(`src="(/assets/[^"]+\.js)"`).FindStringSubmatch(entry.Body.String())
	if len(match) != 2 {
		t.Fatal("构建入口没有脚本地址")
	}
	asset := match[1]
	first := do(t, s, http.MethodGet, asset, key, "")
	etag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || etag == "" || first.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("首次请求资源失败：status=%d ETag=%q Cache-Control=%q", first.Code, etag, first.Header().Get("Cache-Control"))
	}
	for _, tc := range []struct {
		etag string
		want int
	}{{etag, http.StatusNotModified}, {`"stale"`, http.StatusOK}} {
		req := httptest.NewRequest(http.MethodGet, asset, nil)
		req.RemoteAddr = "127.0.0.1:34567"
		req.Header.Set("If-None-Match", tc.etag)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("If-None-Match %q: status=%d, want %d", tc.etag, rec.Code, tc.want)
		}
		if tc.want == http.StatusNotModified && rec.Body.Len() != 0 {
			t.Errorf("304 不应带响应体，实际 %d 字节", rec.Body.Len())
		}
	}
}

// 确保资源路由不提供子目录、路径穿越或不属于静态目录的文件。
func TestConsoleAssetPathIsWhitelisted(t *testing.T) {
	s, key := newTestServer(t, nil)
	for _, route := range []string{
		"/assets/../../etc/passwd", "/assets/%2e%2e/secret.js", "/assets/sub/index.js",
		"/assets/%5csecret.js", "/assets/missing.js", "/js/../../etc/passwd",
		"/js/sub/app.js", "/web/dist/index.html", "/neat.css",
	} {
		rec := do(t, s, http.MethodGet, route, key, "")
		if rec.Code == http.StatusOK || strings.Contains(rec.Body.String(), "root:x:") {
			t.Errorf("GET %s 不应提供资源，status=%d", route, rec.Code)
		}
	}
}
