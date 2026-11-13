package server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// TestConsoleAssetsServed 守住控制台的资源接线。
//
// 控制台已拆成「标记 + 样式 + ES module」：`go:embed` 少列一条、路由漏注册，
// 都会变成运行时 404（页面白屏但 go test 全绿）。这里逐个访问一遍。
func TestConsoleAssetsServed(t *testing.T) {
	s, key := newTestServer(t, nil)

	cases := []struct {
		path     string
		ctype    string
		contains string
		html     bool
	}{
		{"/", "text/html", "/assets/", true},
		{"/style.css", "text/css", "--bg", false},
		{"/js/theme-boot.js", "text/javascript", "data-theme", false},
		{"/js/app.js", "text/javascript", "from './i18n.js'", false},
		{"/js/i18n.js", "text/javascript", "./i18n/core.js", false},
		{"/js/i18n/core.js", "text/javascript", "I18N_EN", false},
		{"/js/i18n/dict-pages.js", "text/javascript", "PAGES_DICT", false},
		{"/js/format.js", "text/javascript", "fmtCompact", false},
		{"/js/state.js", "text/javascript", "acctPageSize", false},
		{"/js/render/accounts.js", "text/javascript", "renderAccounts", false},
		{"/js/render/logs.js", "text/javascript", "renderLogs", false},
		{"/js/render/keys.js", "text/javascript", "renderKeys", false},
		{"/js/render/settings.js", "text/javascript", "renderSettings", false},
	}
	for _, c := range cases {
		rec := do(t, s, http.MethodGet, c.path, key, "")
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d，期望 200", c.path, rec.Code)
			continue
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, c.ctype) {
			t.Errorf("GET %s 的 Content-Type = %q，期望包含 %q", c.path, ct, c.ctype)
		}
		if !strings.Contains(rec.Body.String(), c.contains) {
			t.Errorf("GET %s 的内容里找不到 %q", c.path, c.contains)
		}
		// 页面不缓存（随二进制更新），静态资源用 ETag 重校验：
		// no-store 会让首屏 17 个模块每次都全量重下。
		cc := rec.Header().Get("Cache-Control")
		if c.html {
			if cc != "no-store" {
				t.Errorf("GET %s 的 Cache-Control = %q，期望 no-store", c.path, cc)
			}
		} else {
			if cc != "no-cache" {
				t.Errorf("GET %s 的 Cache-Control = %q，期望 no-cache", c.path, cc)
			}
			if rec.Header().Get("ETag") == "" {
				t.Errorf("GET %s 缺少 ETag（无法 304 重校验）", c.path)
			}
		}
		// 页面与脚本都承载管理会话，CSP 不能漏。
		if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
			t.Errorf("GET %s 缺少严格 CSP，实际 %q", c.path, csp)
		}
	}
}

// TestConsoleAssetConditionalGET 验证 ETag 能命中 304（升级后自然失效）。
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
		"/js/sub/app.js", "/js/i18n/sub/core.js", "/js/i18n/%2e%2e/app.js", "/web/dist/index.html", "/neat.css",
	} {
		rec := do(t, s, http.MethodGet, route, key, "")
		if rec.Code == http.StatusOK || strings.Contains(rec.Body.String(), "root:x:") {
			t.Errorf("GET %s 不应提供资源，status=%d", route, rec.Code)
		}
	}
}
