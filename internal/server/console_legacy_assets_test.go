package server

import (
	"sort"
	"strings"
)

// 旧页面可能仍在用户浏览器中运行；这些辅助函数只供兼容性测试读取其内嵌资源。
var (
	consoleHTML      = mustConsoleAsset("web/index.html")
	consoleLoginHTML = mustConsoleAsset("web/login.html")
	consoleCSS       = mustConsoleAsset("web/style.css")
)

func consoleScriptNames() []string {
	var names []string
	for _, dir := range []string{"web/js", "web/js/render", "web/js/i18n"} {
		entries, err := consoleAssets.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".js") {
				names = append(names, dir+"/"+entry.Name())
			}
		}
	}
	sort.Strings(names)
	return names
}

func consoleJS() string {
	var scripts strings.Builder
	for _, name := range consoleScriptNames() {
		if raw, err := consoleAssets.ReadFile(name); err == nil {
			scripts.Write(raw)
			scripts.WriteByte('\n')
		}
	}
	return scripts.String()
}
