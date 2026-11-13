package server

import (
	"net/http"
	"testing"
)

// 语言查询参数由客户端解释，服务端不能把带参数的入口误判为未知路径。
// 实际语言切换和持久化由 frontend/tests/shell.test.tsx 验证。
func TestConsoleLanguageQueryKeepsEntryAvailable(t *testing.T) {
	s, key := newTestServer(t, nil)
	baseline := do(t, s, http.MethodGet, "/", key, "")
	for _, route := range []string{"/?lang=zh", "/?lang=en", "/login?lang=en"} {
		rec := do(t, s, http.MethodGet, route, key, "")
		if rec.Code != http.StatusOK || rec.Body.String() != baseline.Body.String() {
			t.Errorf("GET %s 应返回控制台入口，得到 %d", route, rec.Code)
		}
	}
}
