# YangCi Desktop 安装包

当前提供 Windows x64 NSIS 安装器、Linux x64 `.deb` 包和 macOS `.dmg` / `.zip` 包。安装包内置 Electron、USB 串口组件、原生 DDC 控制组件、显示器配置档及应用图标；日常显示器控制和 Wi-Fi 配置无需 Node.js、Rust 或源码目录。

## 构建

在对应平台安装 Node.js 22、Rust 及项目原有的 sidecar 编译依赖后执行：

| 平台 | 命令 | 输出 |
| --- | --- | --- |
| Windows x64 | `npm run package:windows` | `release/YangCi-<版本>-windows-x64-setup.exe` |
| Linux x64 | `npm run package:linux` | `release/YangCi-<版本>-linux-amd64.deb` |
| macOS | `npm run package:macos` | `release/YangCi-<版本>-macos-<arch>.dmg` 和 `.zip` |

```bash
npm ci
npm run package:windows  # 或 package:linux / package:macos
```

构建自动从 `desktop/assets/icon.svg` 生成各尺寸图标，再编译 sidecar 和 Electron 应用。生成的 PNG、安装包和压缩包不提交到 Git。macOS 包使用当前构建机的 Electron 架构，未做签名；首次打开需按系统提示在“设置 → 隐私与安全性”中允许。

## GitHub Release

推送 `v*` 或 `V*` 格式的版本标签会触发 `.github/workflows/release.yml`：

```bash
git tag V1.0.2
git push origin V1.0.2
```

工作流会在 Windows、Linux 和 macOS runner 上分别打包，生成每个平台的 SHA256 清单，并把安装器上传到同名 GitHub Release。发布前应同步 `package.json`、`package-lock.json`、`firmware/version.txt` 和 `CHANGELOG.md` 的版本信息。

## 安装与启动

### Windows

运行生成的 `YangCi-<版本>-windows-x64-setup.exe`。安装器支持选择安装目录，并创建开始菜单与桌面快捷方式；默认按当前用户安装，不需要管理员权限。

### Linux

```bash
sudo apt install ./release/YangCi-1.0.2-linux-amd64.deb
```

随后在应用菜单搜索 **YangCi**，可以固定到 Dock。也可运行 `yangci-desktop`；主程序和 Electron 子进程都使用这个名称，旧命令 `azoria-desktop` 继续转到新程序。首次从开发版切换时先退出开发版，避免两个程序争用控制端口；安装版重复启动会激活已有窗口。

配置继续保存在 `~/.config/YangCi/`，升级安装不清除配对信息。程序安装在 `/opt/YangCi/`，不依赖启动时所在目录。安装器同时注册桌面图标和应用专用的 Ubuntu AppArmor 用户命名空间配置，无需以 `--no-sandbox` 启动。

Ubuntu 启用 AppIndicators 时，YangCi 图标显示在顶部状态栏。托盘菜单可打开、隐藏或退出程序；默认关闭窗口会隐藏到托盘，后台继续处理 Touch 控制。

USB 串口和 Linux I²C 的用户访问权限仍由系统管理。这台测试机已有 `dialout`、`i2c` 组权限；其他电脑需要按硬件测试文档配置。固件身份校验、固件文件检查和刷写功能目前仍依赖本机 PlatformIO 的 Python/esptool，尚未作为独立工具打入安装包。

卸载应用可使用 `sudo apt remove azoria-display-control`，用户配置会保留。

### macOS

打开生成的 `.dmg`，把 **YangCi** 拖入“应用程序”。包未签名，首次启动如被 Gatekeeper 拦截，在“系统设置 → 隐私与安全性”中选择“仍要打开”。`.zip` 保留给需要直接检查应用包结构的场景。
