package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestConsoleSmoke 运行新控制台的 API、认证、导航和页面行为测试。
// Go 构建不依赖 Node；没有安装前端依赖时跳过，CI 会单独安装并运行。
func TestConsoleSmoke(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("未安装 Node，跳过前端行为测试")
	}
	root, err := filepath.Abs(filepath.Join("..", "..", "frontend"))
	if err != nil {
		t.Fatal(err)
	}
	vitest := filepath.Join(root, "node_modules", "vitest", "vitest.mjs")
	if _, err := os.Stat(vitest); err != nil {
		t.Skip("未安装前端依赖，跳过前端行为测试")
	}
	for _, args := range [][]string{{vitest, "run"}, {filepath.Join(root, "scripts", "test-native.mjs")}} {
		cmd := exec.Command(node, args...)
		cmd.Dir = root
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("控制台行为测试失败：%v\n%s", err, out)
		}
	}
}
