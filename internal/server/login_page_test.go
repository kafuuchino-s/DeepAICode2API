package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"deepaicode2api/internal/store"
)

// 管理口令登录页（/login）与它的校验入口（/admin/api/auth）。
//
// 回归背景：控制台顶栏原本直接摆一个口令输入框，口令在屏幕上、在长驻页面上
// 一直可见。改成独立登录页后，这条链路不能断：页面能打开、校验能生效、
// 未设口令时本机不挡人。

func TestLoginPageServed(t *testing.T) {
	u := newWarmupUpstream(t)
	s, _ := newTestServer(t, u)

	rec := do(t, s, http.MethodGet, "/login", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("/login HTTP %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("/login Content-Type = %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `id="root"`) || !strings.Contains(body, `/assets/`) {
		t.Error("/login 应返回构建后的控制台入口")
	}
	// 登录表单、错误反馈及口令存储由前端行为测试覆盖。
	if strings.Contains(body, `id="acctTable"`) {
		t.Error("/login 不应直接包含控制台账号表")
	}
}

func TestAdminAuthPasswordHeader(t *testing.T) {
	u := newWarmupUpstream(t)
	s, _ := newTestServer(t, u)
	s.Store.UpdateSettings(func(st *store.Settings) { st.AdminPassword = "s3cret" })

	// 新登录表单发送 X-Admin-Password；不能只测试 Bearer 兼容方式。
	for _, tc := range []struct {
		password string
		want     int
	}{{"wrong", http.StatusUnauthorized}, {"s3cret", http.StatusOK}} {
		req := httptest.NewRequest(http.MethodPost, "/admin/api/auth", strings.NewReader("{}"))
		req.RemoteAddr = "127.0.0.1:34567"
		req.Header.Set("X-Admin-Password", tc.password)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("使用 X-Admin-Password 登录：status=%d，want %d", rec.Code, tc.want)
		}
	}
}

func TestAdminAuthEndpoint(t *testing.T) {
	u := newWarmupUpstream(t)
	s, _ := newTestServer(t, u)

	// 未设管理口令：本机请求直接放行（否则控制台永远进不去）。
	if rec := do(t, s, http.MethodPost, "/admin/api/auth", "", "{}"); rec.Code != http.StatusOK {
		t.Fatalf("未设口令时应 200，实际 %d", rec.Code)
	}

	s.Store.UpdateSettings(func(st *store.Settings) { st.AdminPassword = "s3cret" })
	if rec := do(t, s, http.MethodPost, "/admin/api/auth", "", "{}"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("缺口令应 401，实际 %d", rec.Code)
	}
	// do() 会把口令放进 Authorization: Bearer。
	if rec := do(t, s, http.MethodPost, "/admin/api/auth", "wrong", "{}"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("错口令应 401，实际 %d", rec.Code)
	}
	if rec := do(t, s, http.MethodPost, "/admin/api/auth", "s3cret", "{}"); rec.Code != http.StatusOK {
		t.Fatalf("对口令应 200，实际 %d", rec.Code)
	}
	// 返回体里不能带口令本身。
	var body map[string]any
	rec := do(t, s, http.MethodPost, "/admin/api/auth", "s3cret", "{}")
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析: %v", err)
	}
	if len(body) != 1 || body["ok"] != true {
		t.Fatalf("返回体只应有 {ok:true}，实际 %#v", body)
	}
}

func TestHealthExposesAdminRequired(t *testing.T) {
	u := newWarmupUpstream(t)
	s, _ := newTestServer(t, u)

	read := func() bool {
		rec := do(t, s, http.MethodGet, "/health", "", "")
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("解析 /health: %v", err)
		}
		v, ok := body["admin_required"].(bool)
		if !ok {
			t.Fatalf("/health 缺少 admin_required 字段：%#v", body)
		}
		return v
	}

	if read() {
		t.Fatal("未设口令时 admin_required 应为 false")
	}
	s.Store.UpdateSettings(func(st *store.Settings) { st.AdminPassword = "s3cret" })
	if !read() {
		t.Fatal("设了口令后 admin_required 应为 true")
	}
}
