# 账号与密钥浏览器回归

测试入口使用内存账号、密钥、配额和 OAuth 会话拦截所有管理请求，不会连接上游或读取真实数据。需要先安装 `frontend` 的依赖和 `agent-browser`。

在 `frontend/` 启动独立的测试服务器：

```sh
npx vite --config src/features/accounts/__tests__/vite.fixture.config.ts --host 127.0.0.1 --port 4178 --strictPort
```

在新浏览器会话中运行：

```sh
agent-browser --session accounts-qa open 'http://127.0.0.1:4178/src/features/accounts/__tests__/index.html?lang=en#accounts?group=alpha&page=1'
agent-browser --session accounts-qa eval 'window.runFixtureTests()'
```

测试要求初始分页及脱敏偏好为空；再次运行时使用新的浏览器会话，或清除本地存储后重新加载上述地址。返回值列出通过的场景；失败时抛出错误。测试会修改 fixture 的内存状态，重新加载页面即可重置。回归同时检查主按钮的文字对比度和创建密钥弹窗的居中位置。

页面顶部的 Language 和 Theme 可用于人工检查双语及明暗主题；切换 Accounts / Keys 可分别检查桌面表格、手机卡片和操作弹窗。追加 `shell=1` 可在真实应用外壳内检查布局，管理接口、健康状态和版本仍由内存 fixture 返回：

```text
http://127.0.0.1:4178/src/features/accounts/__tests__/index.html?lang=zh&shell=1#accounts
```

例如用 `agent-browser --session accounts-qa set viewport 1440 900` 或 `set viewport 390 844` 切换桌面和手机视口，使用侧栏的主题按钮检查明暗模式。`window.runFixtureTests()` 使用不带 `shell=1` 的入口。
