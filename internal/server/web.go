package server

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"net/http"
	"path"
	"strings"
	"sync"
)

// React 控制台构建产物和兼容旧页面缓存的静态资源都内嵌到二进制。
// 修改 frontend 后需更新 web/dist；运行和 Go 构建不需要 Node。
//
//go:embed web/index.html web/login.html web/style.css web/favicon.ico web/apple-touch-icon.png web/js/*.js web/js/render/*.js web/js/i18n/*.js web/dist
var consoleAssets embed.FS

func mustConsoleAsset(name string) []byte {
	b, err := consoleAssets.ReadFile(name)
	if err != nil {
		panic("控制台资源缺失: " + name + ": " + err.Error())
	}
	return b
}

// consoleAssetType 给出内嵌资源的 Content-Type。
func consoleAssetType(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".ico":
		// 官方类型是 image/vnd.microsoft.icon（RFC 7903），但 image/x-icon 是
		// 实际世界里最常见的写法、所有浏览器都认，这里跟 nginx 的默认保持一致。
		return "image/x-icon"
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	default:
		return "application/octet-stream"
	}
}

// serveConsole 输出控制台单页。
//
// 响应头刻意收紧：禁止缓存、禁止 MIME 嗅探、不发送 Referer。
// 资源与页面同源、无外部引用，因此不需要放宽 CSP。
func serveConsole(w http.ResponseWriter, r *http.Request) {
	serveConsoleAsset(w, r, "web/dist/index.html")
}

// serveLogin 输出管理口令登录页（/login）。
//
// 与控制台使用同一构建入口，认证和导航由客户端处理。
func serveLogin(w http.ResponseWriter, r *http.Request) {
	serveConsoleAsset(w, r, "web/dist/index.html")
}

// consoleCSP 是控制台页面的内容安全策略。
//
// 控制台承载管理口令，是整套系统里最值得加 CSP 的页面。资源全部同源、
// 无外部引用，因此不需要放宽任何一条：
//   - script-src 'self'：内联脚本一律禁止（主题启动脚本也做成了外部文件）；
//   - style-src 'self'：inline style 属性已从标记里移除（统一改用具名工具类）；
//   - connect-src 'self'：控制台只调自己的 /admin/api/*；
//   - frame-ancestors 'none' + form-action 'self'：防点击劫持与外发。
const consoleCSP = "default-src 'self'; script-src 'self'; style-src 'self'; " +
	"img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
	"base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

// assetETags 缓存内嵌资源的内容指纹（资源在编译期固定，算一次即可）。
var assetETags sync.Map // name -> string

// assetETag 返回资源的内容 ETag（形如 "abc…"）。
func assetETag(name string, raw []byte) string {
	if v, ok := assetETags.Load(name); ok {
		return v.(string)
	}
	sum := sha256.Sum256(raw)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	assetETags.Store(name, etag)
	return etag
}

// serveConsoleAsset 输出一个内嵌控制台资源（页面 / 样式 / 脚本）。
func serveConsoleAsset(w http.ResponseWriter, r *http.Request, name string) {
	raw, err := consoleAssets.ReadFile(name)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	h := w.Header()
	h.Set("Content-Type", consoleAssetType(name))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	// 页面与脚本同源，CSP 对两者都生效（页面里没有内联脚本 / 样式）。
	h.Set("Content-Security-Policy", consoleCSP)

	// 资源随二进制一起更新：HTML 每次都重新校验，JS/CSS 用 ETag 命中 304。
	// 旧实现一律 no-store，导致首屏 17 个模块每次全量重下。
	etag := assetETag(name, raw)
	h.Set("ETag", etag)
	if strings.HasSuffix(name, ".html") {
		h.Set("Cache-Control", "no-store")
	} else {
		h.Set("Cache-Control", "no-cache")
		if etagMatches(r.Header.Get("If-None-Match"), etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	_, _ = w.Write(raw)
}

// handleConsoleAsset 输出 Vite 资源、图标和旧版本缓存页面引用的静态资源。
//
// 路径按类型限定并拒绝目录或路径穿越。
func (s *Server) handleConsoleAsset(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/")
	var name string
	switch {
	case p == "style.css":
		name = "web/style.css"
	case p == "favicon.ico":
		// 浏览器自动请求的固定路径；标签页/书签图标（多尺寸 ICO，见 docs/assets）
		name = "web/favicon.ico"
	case p == "apple-touch-icon.png":
		// iOS 主屏图标只认 PNG（ICO 会被忽略），所以单独放一张 180×180
		name = "web/apple-touch-icon.png"
	case strings.HasPrefix(p, "assets/"):
		rest := strings.TrimPrefix(p, "assets/")
		// Vite 输出的资源位于扁平目录；不接受子目录或路径片段。
		if rest == "" || strings.ContainsAny(rest, "/\\") || strings.Contains(rest, "..") {
			http.NotFound(w, r)
			return
		}
		name = "web/dist/assets/" + rest
	case strings.HasPrefix(p, "js/render/"):
		// render/ 下只允许一层扁平文件名
		rest := strings.TrimPrefix(p, "js/render/")
		if rest == "" || strings.ContainsAny(rest, "/\\") || strings.Contains(rest, "..") {
			http.NotFound(w, r)
			return
		}
		name = "web/js/render/" + rest
	case strings.HasPrefix(p, "js/i18n/"):
		// i18n/ 与 render/ 同规则：只允许一层扁平文件名
		rest := strings.TrimPrefix(p, "js/i18n/")
		if rest == "" || strings.ContainsAny(rest, "/\\") || strings.Contains(rest, "..") {
			http.NotFound(w, r)
			return
		}
		name = "web/js/i18n/" + rest
	case strings.HasPrefix(p, "js/"):
		rest := strings.TrimPrefix(p, "js/")
		// 只允许扁平文件名：不能有子目录、反斜杠或 ..
		if rest == "" || strings.ContainsAny(rest, "/\\") || strings.Contains(rest, "..") {
			http.NotFound(w, r)
			return
		}
		name = "web/js/" + rest
	default:
		http.NotFound(w, r)
		return
	}
	serveConsoleAsset(w, r, name)
}
