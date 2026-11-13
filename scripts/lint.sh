#!/bin/sh
# 本地检查：格式、vet、前端类型和行为、Go 测试。
set -eu

cd "$(dirname "$0")/.."

files=$(gofmt -l . || true)
if [ -n "$files" ]; then
	echo "以下文件未格式化："
	echo "$files"
	echo "运行 make fmt 修复。"
	exit 1
fi

go vet ./...

# 前端测试需要安装依赖；只使用 Go 工具链的环境仍可运行其余检查。
# CI 会安装依赖并额外验证生成的静态资源与源码一致。
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
	if [ -d frontend/node_modules ]; then
		(cd frontend && npm exec -- tsc --noEmit)
		npm --prefix frontend test
		echo "前端类型与行为测试：通过"
	else
		echo "未安装前端依赖，跳过前端检查；运行 npm --prefix frontend ci 后重试。"
	fi
else
	echo "未安装 node 或 npm，跳过前端检查"
fi

go test -count=1 ./...
