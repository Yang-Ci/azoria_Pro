# AZORIA Desktop Linux 安装包

当前提供 Ubuntu 24.04 x86_64 的 `.deb` 包。内置 Electron、USB 串口组件、原生 DDC 控制组件、显示器配置档及应用图标；日常显示器控制和 Wi-Fi 配置无需 Node.js、Rust 或源码目录。

## 构建

在 Linux x86_64 开发机安装 Node.js、Rust 及项目原有的 sidecar 编译依赖后执行：

```bash
npm ci
npm run package:linux
```

输出为 `release/AZORIA-Desktop-0.1.0-linux-amd64.deb`。构建自动从 `desktop/assets/icon.svg` 生成各尺寸图标，再编译并打包应用。生成的 PNG 和安装包不提交到 Git。

## 安装与启动

```bash
sudo apt install ./release/AZORIA-Desktop-0.1.0-linux-amd64.deb
```

随后在应用菜单搜索 **AZORIA Desktop**，可以固定到 Dock。也可运行 `azoria-desktop`。首次从开发版切换时先退出开发版，避免两个程序争用控制端口；安装版重复启动会激活已有窗口。

配置继续保存在 `~/.config/AZORIA Desktop/`，升级安装不清除配对信息。程序安装在 `/opt/AZORIA Desktop/`，不依赖启动时所在目录。安装器同时注册桌面图标和应用专用的 Ubuntu AppArmor 用户命名空间配置，无需以 `--no-sandbox` 启动。

USB 串口和 Linux I²C 的用户访问权限仍由系统管理。这台测试机已有 `dialout`、`i2c` 组权限；其他电脑需要按硬件测试文档配置。固件身份校验、固件文件检查和刷写功能目前仍依赖本机 PlatformIO 的 Python/esptool，尚未作为独立工具打入安装包。

卸载应用可使用 `sudo apt remove azoria-display-control`，用户配置会保留。
