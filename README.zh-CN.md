# YangCi

> 来源与致谢：本项目最初基于 [ayedaren/azoria](https://github.com/ayedaren/azoria)，
> 此后持续重构和扩展桌面端、硬件控制与 Touch 固件。

<div align="center">

**中文** · [English](README.md)

</div>

YangCi 是本地运行的桌面控制中心：调节显示器、查看正在播放的音乐和歌词，
并管理可选的 **AZORIA Touch** 小屏。桌面 App 可独立使用；接入 480×480 ESP32-S3
触摸屏后，常用控制、歌词和壁纸就能放在手边。

显示器控制和设备通信在本机或私有局域网内完成。在线歌词匹配与封面补全会访问
对应音乐服务，因此这部分需要网络。

## 桌面端 App

### 显示器控制

![YangCi 桌面 App：显示器选择、亮度、音量、信号源与静音](docs/images/yangci-desktop-control.jpg)

选择当前控制的显示器，调节亮度、音量和静音，切换 DisplayPort、HDMI 1、HDMI 2、
USB-C 或笔记本内屏目标。程序自动探测视频链路 DDC/CI 与 USB HID 路径，并支持
内置或导入的显示器配置表。外接屏的音量与信号源能力取决于显示器；选择 Windows / Linux
笔记本内屏时，音量和静音控制系统默认播放设备，包括耳机。

### 多显示器联动、电脑状态与后台运行

在“显示器”页勾选参与联动的屏幕，读取当前亮度或分别填写基准后保存。例如主屏 60%、
副屏 40%，统一偏移 +10 点时得到 70% / 50%。整体偏移范围限制为 -40 至 +40 点，
始终保持 20 点差值。联动使用各显示器的视频 DDC/CI 或内屏亮度接口，断开或不支持
该接口的屏幕单独显示错误，其他屏幕继续调整。启用后桌面端、Touch 和快捷键的亮度
控制共用联动设置。还可保存实际亮度为最多 16 个场景，从面板、托盘或快捷键切换。

“电脑状态”页每 2 秒显示全部核心的 CPU 平均使用率、内存使用率与容量、活动网卡的
上传 / 下载速度合计及近一分钟趋势。Touch 首页点击 **PC Status** 查看相同指标，
支持 Wi-Fi 和 BLE；离线或过期数据显示等待状态。GPU 与温度适配留待后续扩展。

在“设置”页配置关闭窗口后常驻托盘；托盘菜单可打开窗口、增减 5 点亮度、选择场景
或退出。全局快捷键默认关闭，启用后默认 Ctrl / Command + Alt + ↑ / ↓ 调亮度，
Ctrl / Command + Alt + S 切换场景，也可修改组合键。Windows / macOS 安装版可选择
登录时自动启动，默认关闭；快捷键占用会提示并保留原设置。

### 音乐与歌词

![YangCi 桌面 App：封面、歌曲信息、播放控制与同步歌词](docs/images/yangci-desktop-music.jpg)

读取系统媒体会话中的歌曲、歌手、专辑、封面和播放进度，适配网易云音乐、QQ 音乐
以及提供媒体会话的其他桌面或网页播放器。歌词可从网易云、QQ 音乐或 LRCLIB 匹配，
当前句随进度高亮。

提供上一首、播放 / 暂停、下一首、进度拖动及播放模式控制；按钮是否可用由播放器
实际提供的能力决定。点击歌词可跳转到该句；未提供跳转能力的播放器可用点击歌词
校准同步进度。连接 Touch 后，歌曲信息、歌词和播放状态同步到小屏。

### Touch 连接、壁纸与息屏

![YangCi 桌面 App：Touch 连接、Wi-Fi 配置、定时息屏与壁纸](docs/images/yangci-desktop-touch.jpg)

| 功能 | 使用方式 |
| --- | --- |
| 设备连接 | USB 识别 Touch、准备蓝牙并连接 BLE；也可通过 USB 扫描和配置 2.4 GHz Wi-Fi，随后自动发现局域网设备。 |
| 图片 / 动态壁纸 | 添加图片或视频前预览 480×480 裁切效果，调整水平、垂直位置和 1–3 倍缩放；保存到最多 100 张的壁纸库，可预览、显示和删除。TF 卡优先；动态壁纸最长 10 秒、目标 25 帧、最多 24 MB，无卡时壁纸需小于 3 MB。 |
| 播放列表 / 定时切换 | 勾选壁纸加入播放列表，可调整顺序，按 1 分钟至 24 小时间隔顺序循环或随机轮播；最多配置 24 条每天指定时间切换到指定壁纸的规则。保存后由桌面端执行并通过局域网同步。 |
| 自动进入壁纸 | 无操作 1、5、10 或 30 分钟后进入，也可关闭；触摸壁纸返回控制页。 |
| 定时息屏 | 自定义开始和结束时间，支持跨午夜；时段内关闭 Touch 背光，结束后恢复。默认关闭，预设时间为 23:00–07:00。 |
| 屏幕方向 | 在 Touch 设置中点击“旋转 90°”，按顺时针在 0°、90°、180°、270° 之间循环；方向保存后通过 Wi-Fi / BLE 同步，画面、触摸坐标和静态 / 动态壁纸一起旋转。需要更新 Touch 固件。 |
| 诊断 | 查看控制成功率、平均 / P95 耗时、路径失败和回读不一致，以及最近事件。 |
| 配置与开发 | 设置中使用配置向导或加载显示器配置表；开启默认关闭的开发者模式后，可选择应用固件，校验设备身份与文件哈希并通过 USB 刷写。 |

## AZORIA Touch 小屏

![AZORIA Touch 正常页面：显示器控制、音乐与沉浸式歌词](docs/images/azoria-touch-ui-overview.png)

| 页面 | 功能与操作 |
| --- | --- |
| 首页 | 查看时间、连接状态，调节显示器亮度、音量、静音和控制源；从顶部下滑调节小屏背光。 |
| 电脑状态 | 点击首页 **PC Status**，查看 CPU、内存、下载 / 上传速度及近一分钟趋势；每 2 秒更新，右上角返回首页。 |
| 音乐 | 点击左上角 **Music** 字标进入，显示封面、歌曲信息、歌词和播放进度，提供切歌、播放 / 暂停和模式切换。 |
| 沉浸式歌词 | 点击音乐页的当前歌词进入，以大字显示当前句及前后歌词；点击页面返回普通音乐页。 |
| 下滑调节音量 | 普通音乐页和沉浸式页面均可从顶部下滑调节音量，与首页和桌面端同步；向上滑动或点击 × 收起，仍停留在当前页面。首页的背光面板也支持上滑收起。 |
| 壁纸 | 点击 Music 下方的电脑图标进入，或等待设置的空闲时间；触摸一次返回。 |

BLE 可独立用于日常控制、歌曲信息与歌词同步；**封面和壁纸同步需要 Touch 与桌面端
接入同一局域网**。实际封面来自播放器或音乐服务，示例封面不会替换正在播放的歌曲封面。

以上桌面截图由当前 React 界面渲染，小屏截图由当前 LVGL 界面直接渲染；设备状态、
歌曲“星夜 / YangCi Demo”和歌词均为演示数据，封面为原创示例图。详见
[截图与素材说明](docs/images/README.md)。

## 架构与设备能力

- Electron + React 桌面界面，通过白名单 IPC 调用本机服务；
- Rust Sidecar 提供原生 DDC/CI、LG USB HID/DDC，以及平台支持的笔记本内屏控制；
- Desktop 主动发现、Touch 被动响应，支持 BLE 和私有 Wi-Fi 局域网；
- 多台 Desktop 在线时协调执行显示器命令，避免同一命令重复写入；
- 固件内置带大小与 SHA-256 校验的 BLE OTA 服务；桌面端提供 USB 应用固件刷写入口。

## 目录

```text
azoria-display-control/
├── desktop/
│   ├── profiles/        # 内置显示器配置表
│   └── src/
│       ├── main/        # Electron 主进程与硬件协调
│       ├── preload/     # 白名单 IPC 桥
│       ├── renderer/    # React + shadcn/ui 界面
│       └── shared/      # 跨进程类型契约
├── firmware/
│   ├── assets/          # 固件图标源文件
│   ├── include/         # 板卡配置
│   └── src/
│       ├── features/    # AZORIA Touch 产品功能
│       ├── platform/    # 屏幕与触摸硬件适配
│       ├── services/    # 配网、BLE 与设备配置
│       └── ui/          # LVGL 公共界面组件和生成资源
└── sidecar/             # Rust DDC/CI 与 USB HID 硬件层
```

## 硬件

当前针对 VIEWE UEDX48480040E-WB-A V1.3、480×480 GC9503 RGB LCD、FT6336U
触摸屏和 16MB Flash / 8MB PSRAM 验证。显示器控制目前已验证 LG 32UQ85R；其他型号需要单独确认 DDC 或 USB HID 映射。

## 快速开始

开发环境需要 Node.js 22 或更高版本与 Rust；仅构建小屏固件时需要 PlatformIO。

```bash
npm install
npm run sidecar:build
npm run dev
```

桌面端首次启动时会在应用数据目录生成本机密钥。密钥、Wi‑Fi 密码和设备配置
不会写入源码。主窗口可以控制显示器，并检测通过 USB 连接的小屏幕。

AZORIA Touch 是可选的实体输入终端。首次使用时通过 USB 点击“准备蓝牙”，随后日常通信
可以只使用 BLE，不要求 Touch 接入 Wi‑Fi。2.4 GHz Wi‑Fi 是可选的局域网连接方式。使用 Wi‑Fi 时，Touch 不主动扫描主机，而是在私有局域网
被动等待；Desktop 主动广播发现请求，校验协议字段和设备标识后向 Touch 下发本机私网地址
和控制端口。BLE 和 Wi‑Fi 都可以独立作为 Touch 到 Desktop 的连接路径。

Touch 通过 Wi‑Fi 或 BLE 建立连接后，由 Desktop 状态响应同步当前 Unix 时间和主机时区
偏移，因此屏幕时间跟随当前 Desktop，不依赖固定时区或单独的公网 NTP 服务。

点击 Touch 控制页左上角的 Music 字标可打开音乐页。音乐页显示 Desktop 当前识别的
歌曲、歌手和播放模式，并可通过 BLE 或局域网执行上一首、播放/暂停、下一首和模式切换。
在音乐页或沉浸式歌词页顶部向下滑动，可打开系统音量面板；调节后向上滑动或点击 × 收起，
无需返回控制页。音量会与控制页及 Desktop 同步。

在 Desktop 的“AZORIA Touch”页可添加图片或视频，在保存前预览并调整 480×480 裁切区域。
视频转换为适合 ESP32-S3 播放的循环 JPEG 帧包，并通过局域网同步。壁纸库在本机保存最多
100 张图片或动态壁纸，旧版的单张壁纸会自动迁入。点击“显示”立即切换当前壁纸；勾选
“加入播放列表”后可以调整顺序、启用顺序或随机轮播，并设置切换间隔。每天定时规则按
电脑本地时间执行，同一时间只能启用一条；定时规则与轮播同时到期时，优先显示定时指定
的壁纸，再从该时刻重新计算轮播间隔。电脑睡眠后恢复时应用最近一条错过的定时规则。
修改播放列表或规则后需点击“保存播放设置”。轮播与定时切换需要 Desktop 运行且 Touch
连接同一局域网；离线小屏继续显示最后同步的壁纸。删除壁纸会清理相关列表项和定时规则；
“停止显示”暂停轮播与每日规则并保留壁纸库。点击 Touch 上 Music
字标下方的电脑图标可立即进入壁纸模式；Desktop 可将无操作自动进入时间设置为 1、5、
10、30 分钟或关闭，设置会同步并保存在 Touch 上；触摸壁纸一次即可返回控制页。插入
TF 卡时优先使用卡内存储，桌面端生成的动态壁纸最长 10 秒、目标 25 帧、总大小不超过 24 MB；
未插卡时自动使用板载数据分区，壁纸包需小于 3 MB。

需要一次完成外壳和支架打印时，使用
`hardware/enclosure/v3/azoria-touch-all-v3.stl`；该文件包含前壳、后盖和两种背部支架。
[V3 文件夹](hardware/enclosure/v3/)包含 5 个 STL，单独打印与装配说明见
[V3 打印说明](hardware/enclosure/v3/README.md)。

桌面充电站使用独立的 [酷态科 10 Ultra 可调屏幕外壳包](hardware/enclosure/charging-station-v2/README.md)，
包含底座、后板、线盖、四线仓挡片、可调屏框及屏幕后盖；2026-10-06 已同步后盖修正。
先打印试装件，再按说明装配完整充电器和线材。
[下载完整充电站打印包（2026-10-06）](hardware/enclosure/cuktech-desktop-station-v2-2026-10-06.zip)。

局域网通信使用三个固定端口：TCP `8732` 提供状态和设备登记，UDP `8733` 用于 Desktop
发现 Touch 及返回命令结果，UDP `8734` 用于 Desktop 心跳、协调和 Touch 控制命令广播。
多个 Desktop 同时在线时，只有实际具备可用 DDC/CI 路径的主机可以执行命令。首次建立
控制关系后，该主机成为粘性 Master；只要心跳和 DDC/CI 路径保持正常，后续命令不会重复
选举。Master 断线、路径失效或执行失败时，其他有能力的 Desktop 才重新竞争执行权；网络
分区恢复后若出现多个 Master，则按稳定的 Desktop ID 消除冲突。同一命令 ID 的重发使用
缓存结果，不会重复写入显示器。

固件开发、恢复或测试时，在 YangCi 设置中开启“开发者模式”，再进入
出现的“开发者”页。选择本地 AZORIA Touch `.bin` 固件后，程序会校验镜像类型、
版本、校验和与设备身份，并在实际写入前再次核验文件哈希。

## 构建 AZORIA Touch 固件

在项目根目录执行：

```bash
cd firmware
pio run -e viewe_uedx48480040e_wb_a
```

构建成功后，Desktop 所需的应用固件位于：

```text
firmware/.pio/build/viewe_uedx48480040e_wb_a/firmware.bin
```

在 Desktop 的“开发者”页点击“选择固件”，选择这个 `firmware.bin`。不要选择同目录的
`bootloader.bin` 或 `partitions.bin`；它们不是 Desktop 刷写入口接受的应用镜像。
固件版本来自 `firmware/version.txt`；普通本地构建无需改版本号，发布时再与桌面版本协调更新。
`.pio/` 是本地构建目录，
不会提交到仓库；发布版本应把经过测试的 `firmware.bin` 作为独立发布附件提供。

下面的 PlatformIO 上传可能同时写入启动程序和分区表，仅用于首刷或明确要求的完整恢复。
已配置设备的日常升级请使用下文的[仅应用固件烧录流程](#touch-应用固件升级)，先核对实际 OTA 槽位。
首刷时将示例端口替换为当前检测到的设备端口：

```bash
cd firmware
pio run -e viewe_uedx48480040e_wb_a -t upload --upload-port /dev/cu.usbmodemXXXX
```

YangCi 的渲染进程没有 Node.js 权限，硬件操作通过白名单 IPC 完成。Desktop
可以主动发起公网 HTTP/HTTPS 请求，但显示器控制、Touch 发现和协调服务只监听私有 IPv4
地址或 UDP 通配接收地址，并按来源所属的私有子网过滤数据包；公网来源的入站请求会被
拒绝。局域网协议不做身份认证，应仅在可信局域网中使用。

## AI 协作：构建、更新与烧录要求

让 AI 帮忙改代码、构建、更新电脑端或烧录 Touch 时，应先阅读本节、
[固件说明](firmware/README.md)和当前工作区的 `AGENTS.md`（如有），按实际授权完成任务。
以下是本项目的操作约定；示例盘符和串口不是固定配置。

### 先确认任务范围与环境

- 区分修改源码、构建、替换已安装电脑端、烧录 Touch、提交 GitHub 和发布 Release。
  用户已经明确授权的步骤直接按流程执行，无需反复确认；应用升级不包含擦除整片 Flash、
  改分区、重置配对或重新配置 Wi-Fi。这些操作需要用户明确提出。
- 先检查 `git status --short`、当前分支、远端、工具版本、目标程序安装路径和串口。
  保留用户及其他任务的未提交改动；提交时按文件或变更块选择当前任务内容。
  不使用 `git add .`、强制推送、`git reset --hard` 或 `git clean -fd` 覆盖其他工作。
- 使用仓库锁定的依赖；缺少 Node 依赖时运行 `npm ci`，不要为了构建而升级依赖或删除锁文件。
  工具不在 PATH 时先查找已有安装；Windows 的 PlatformIO Python 通常位于
  `%USERPROFILE%\.platformio\penv\Scripts\python.exe`，不能套用 Unix 的 `penv/bin/python`。
- 检查源码盘、构建缓存盘和备份盘的剩余空间。`firmware/.pio/build` 与 `sidecar/target`
  可能是目录联接，清理或迁移前用 `Get-Item` 核对链接和实际目标。
  不要看到 PlatformIO 的临时目录清理提示就递归删除目标缓存；以退出码和最终构建结果判定是否成功。
- 为每次更新建立独立的仓库外暂存 / 备份目录，记录源代码提交、未提交改动、构建结果和产物 SHA-256。
  其他任务正在修改同一源码或构建输出时，不要混用产物；先固定本次源码和产物。
  普通测试不擅自改版本；正式发布时同步 `package.json`、`package-lock.json`、
  `firmware/version.txt` 与 `CHANGELOG.md`。

### 构建与产物核对

在仓库根目录按改动选择检查。桌面端与 Sidecar 都有改动时执行：

```bash
npm run typecheck
node --test desktop/tests/*.test.cjs
npm run sidecar:test
npm run build
```

修改 Codex / API 额度逻辑时再运行 `npm run usage:test`。Touch 固件单独构建：

```bash
pio run --project-dir firmware -e viewe_uedx48480040e_wb_a
```

Windows 中 `pio` 不在 PATH 时，在仓库根目录使用已有 Python：

```powershell
$pioPython = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\python.exe'
& $pioPython -X utf8 -m platformio run --project-dir firmware -e viewe_uedx48480040e_wb_a
if ($LASTEXITCODE -ne 0) { throw '固件构建失败，停止安装和烧录' }
```

`npm run build` 同时更新 `out/` 和 `sidecar/target/release/`；
`npm run desktop:build` 只更新 Electron 产物，修改 Rust 后不能只运行后者。
固件只使用本次构建的 `firmware.bin`，核对 `image-info` 的 ESP32-S3 类型、应用描述和校验结果，
并确认大小不超过实机应用分区。`bootloader.bin`、`partitions.bin` 和合并镜像不能当作应用镜像使用。
版本号、缓存的编译时间或文件名不能单独证明产物来自最新源码。

### 更新已安装的电脑端

1. 确认正在运行的可执行文件和实际安装目录，备份 `resources/app.asar`、相关
   `app.asar.unpacked` 原生依赖及 `resources/sidecar/`。同时备份应用数据目录
   `app.getPath("userData")`；Windows 通常为 `%APPDATA%\YangCi`。
   保留本机密钥、API 凭据、壁纸库与播放设置、显示器配置、亮度场景、息屏、旋转及桌面设置。
2. 在暂存目录准备完整安装包，或在兼容性已核对的旧包上替换本次 `out/`、显示器配置和图标资源后重打包。
   只有 Electron、平台 / 架构及运行时依赖兼容时才能复用旧原生模块；依赖变化时重新制作完整包。
   `app.asar` 与 `app.asar.unpacked` 必须匹配，不能遗漏串口原生模块。
3. 核对 Sidecar 的平台与文件名：Windows 为 `azoria-ddc-sidecar.exe`，Linux / macOS 为
   `azoria-ddc-sidecar`。当前 `electron-builder.yml` 和 `npm run package:linux` 面向 Linux；
   Windows 打包需明确配置目标及 `.exe` 资源，不能直接照搬 Linux 资源路径。
4. 从托盘退出 YangCi，确认目标安装目录的进程及子进程已退出，再替换文件。
   关闭主窗口可能只是隐藏到托盘。文件仍被占用时只处理属于该安装目录的进程。
   使用暂存文件替换，核对安装后哈希；替换失败则恢复备份，避免留下半套资源。
5. 从实际安装目录重启并显示主窗口，核对新界面、显示器状态、Touch 连接和原有配置。
   关闭窗口后还要确认托盘、后台同步与 BLE 轮询正常。测试临时修改的设置应恢复，
   不擅自启用开机启动、全局快捷键或开发者模式。

源码构建成功不等于已安装程序更新成功；交付时应说明两者各自的结果。

### Touch 应用固件升级

默认只更新**实机确认会启动的应用槽**，保留启动程序、分区表、NVS、OTA 元数据和
LittleFS / TF 卡壁纸。每次都重新检测设备，不能沿用上次的 COM 号或默认写 `app0`。

1. 枚举串口，使用 USB 的 `AZORIA_IDENTIFY` → `AZORIA_TOUCH_V1` 握手确认正常运行的 Touch，
   再用 esptool 核对 ESP32-S3 芯片身份、MAC 和 Flash 容量；恢复无法握手的设备时需额外核实目标板卡。
   Windows USB 接口实例串 / `serialNumber` 不一定是芯片 MAC，不能直接用两者相等判断设备身份。
2. 读取并备份实机启动控制区域，解析实际分区表和 `otadata`，核对 OTA 记录的 CRC、状态与序号，
   确认下一次启动使用的槽。双 OTA 常规记录按有效 `ota_seq` 选择，槽号为 `(ota_seq - 1) % 2`；
   记录空白、损坏、待回滚或无法确定时先排查，不能猜测偏移。
3. 备份目标应用分区。把本次构建镜像复制到独立暂存目录，检查镜像和 SHA-256，
   在实际写入前再次确认哈希没有变化，然后只写已确认的应用偏移。
4. Windows 调用 Python / esptool 使用 `-X utf8`，避免进度字符触发 GBK 编码异常。
   所有应用写入都显式保留 `--flash-mode keep --flash-freq keep --flash-size keep`。
   已验证的板卡使用 DIO 启动，不能因为 `platformio.ini` 写着 QIO 就强制改镜像头，否则可能反复重启。

当前[分区配置](firmware/partitions.csv)的预期布局如下，**必须与读出的实机分区表比对**：

| 分区 | 偏移 | 大小 | 日常应用升级 |
| --- | --- | --- | --- |
| NVS | `0x9000` | `0x5000` | 保留 Wi-Fi、配对与设备设置 |
| OTA 元数据 | `0xE000` | `0x2000` | 保留并读取，不盲目改写 |
| `app0` | `0x10000` | `0x640000` | 仅在确认此槽会启动时写入 |
| `app1` | `0x650000` | `0x640000` | 仅在确认此槽会启动时写入 |
| `spiffs` / LittleFS | `0xC90000` | `0x360000` | 保留板载壁纸 |
| Coredump | `0xFF0000` | `0x10000` | 保留 |

下面是 **esptool 5.x / PowerShell** 示例，均从仓库根目录执行。`COM8` 和 D 盘仅是示例；
先按实际环境设置变量。第一段仅准备暂存镜像、核验身份并读取备份，不烧录：

```powershell
$pioPython = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\python.exe'
$port = 'COM8' # 必须替换为此次确认的 Touch 端口
$backupDir = Join-Path 'D:\Touch-Backups' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop | Out-Null
$builtFirmware = (Resolve-Path -LiteralPath 'firmware/.pio/build/viewe_uedx48480040e_wb_a/firmware.bin').Path
$firmware = Join-Path $backupDir 'firmware-staged.bin'
Copy-Item -LiteralPath $builtFirmware -Destination $firmware -ErrorAction Stop

& $pioPython -X utf8 -m serial.tools.list_ports
& $pioPython -X utf8 -m esptool --chip esp32s3 --port $port flash-id
if ($LASTEXITCODE -ne 0) { throw '设备核验失败' }
& $pioPython -X utf8 -m esptool image-info $firmware
if ($LASTEXITCODE -ne 0) { throw '镜像检查失败' }
$firmwareHash = (Get-FileHash -LiteralPath $firmware -Algorithm SHA256).Hash
$bootControl = Join-Path $backupDir 'boot-control.bin'
& $pioPython -X utf8 -m esptool --chip esp32s3 --port $port --baud 921600 read-flash 0x0 0x10000 $bootControl
if ($LASTEXITCODE -ne 0) { throw '启动区域备份失败' }
```

解析 `$bootControl` 后才进入第二段。它包含 NVS 等私有信息，保留在本地，不上传仓库。
以下变量故意留空，需填入已核验的实机值；对上述布局，应用大小为 `0x640000`，
偏移只能选确认会启动的 `0x10000` 或 `0x650000`：

```powershell
$appOffset = $null # 填入从实机分区表与 OTA 状态确认的应用偏移
$appSize = $null   # 填入该应用分区的大小
if ($null -eq $appOffset -or $null -eq $appSize) { throw '先完成分区和 OTA 槽位核验' }
if ((Get-Item -LiteralPath $firmware).Length -gt $appSize) { throw '镜像超过应用分区' }
$previousApp = Join-Path $backupDir 'previous-app.bin'
& $pioPython -X utf8 -m esptool --chip esp32s3 --port $port --baud 921600 read-flash $appOffset $appSize $previousApp
if ($LASTEXITCODE -ne 0) { throw '旧应用备份失败' }
if ((Get-FileHash -LiteralPath $firmware -Algorithm SHA256).Hash -ne $firmwareHash) { throw '待写镜像已变化' }
& $pioPython -X utf8 -m esptool --chip esp32s3 --port $port --baud 921600 write-flash --flash-mode keep --flash-freq keep --flash-size keep $appOffset $firmware
if ($LASTEXITCODE -ne 0) { throw '烧录失败，保留日志并排查' }
```

退出码为 0 且出现写入校验成功才算烧录完成，进度到 100% 不代表已完成校验。
按需用 `verify-flash` 再核对写入内容。重启后重新枚举串口，在 115200 波特率下检查
`AZORIA_IDENTIFY` 握手，再验证 Wi-Fi / BLE、配对、壁纸和本次修改的实际功能。
失败时先读启动日志和确认端口，不能反复擦除 Flash 或重新配网代替排查。

桌面开发者刷写入口目前固定写入 `0x10000`，且工具路径与 USB 身份判断存在平台差异。
仅在工具、身份和 `app0` 启动槽均已核验时使用；Windows 工具不可用或实例串不等于 MAC 时，
应完成上述独立核验再调用 esptool，不能跳过身份检查。普通升级不使用 `erase-flash`、
`-t erase`、文件系统上传或全量 PlatformIO 上传。

### 验证与交付

按实际改动验证完整流程：界面 → IPC / 协议 → Sidecar / 固件 → 回读或画面。
说明哪些检查是模拟、哪些是真机，未做实体双屏测试时不能声称已验证双屏。
记录源代码版本、桌面 / 固件产物哈希、备份位置、烧录槽位、校验结果和仍需用户测试的项目；
纯文档改动核对命令、链接和描述即可，不因此重新构建、安装或烧录。

用户要求上传 GitHub 时，只提交当前任务的源码、测试与文档，推送后确认远端提交与本地一致。
不提交 `out/`、`.pio/`、`target/`、安装包、私有备份、凭据、串口日志或临时验证输出；
正式发布的固件作为单独 Release 附件。说明“已构建”“已安装”“已烧录”“已推送”各自实际完成到哪一步。

## 显示器配置表

显示器控制协议统一为 DDC/CI。Desktop 会区分两种承载路径：显示器 USB 控制接口
提供的“USB HID → DDC/CI”，以及 HDMI、DisplayPort 或 USB-C 视频连接提供的
“视频链路 → DDC/CI”。笔记本内屏使用 `internal-panel` 路径。Windows 通过 WMI
读取 `WmiMonitorBrightness` 并调用 `WmiSetBrightness`；Linux 从已连接的
eDP/LVDS/DSI 连接器和系统背光设备识别内屏，不依赖显示器型号。亮度优先写入
系统背光接口，失败时使用桌面亮度服务。程序会实际探测路径，
而不是只按型号猜测。

这里的“USB HID”不是另一套显示器控制协议。它只是某些显示器用来承载 DDC/CI
报文的厂商 USB 通道；亮度、音量、静音和输入源最终仍以 DDC/CI VCP 功能进行表达。
Desktop 会枚举支持 DDC/CI 的显示器和内屏，并可在控制页或 Profile 向导中
切换当前目标。Windows 的音量和静音通过 Core Audio（WASAPI）控制，Linux 通过
PipeWire/PulseAudio 控制；两者都会跟随系统切换到耳机或其他默认输出。Touch 将内屏
作为独立的第 5 个控制目标；底部区域一次显示 4 个方块，可横向滑动选择内屏。选择内屏
不会写入外接显示器的输入源 VCP，重新选择 DP、HDMI 或 USB-C 时会回到外接显示器。
常用 VCP opcode 如下。配置表中的数字使用 JSON 十进制写法：

| 能力 | VCP opcode | JSON 十进制 |
| --- | --- | ---: |
| 亮度 | `0x10` | `16` |
| 音量 | `0x62` | `98` |
| 静音 | `0x8D` | `141` |
| 输入源 | `0x60` | `96` |

内置配置表位于 `desktop/profiles/`，描述显示器识别条件、VCP opcode、输入源编码和
整台显示器的承载路径优先级。设置页可以加载一份 JSON 配置表；文件经过结构和数值范围
校验后保存到本机配置目录，不允许指定命令、可执行文件或网络地址。验证成熟的配置表
可以直接加入 `desktop/profiles/`，随之后的软件版本内置。

### Profile 向导路线图

| 序号 | 方向 | 状态 |
| --- | --- | --- |
| 1 | 读取显示器身份和可用的 DDC/CI 承载路径。 | 已完成 |
| 2 | 自动匹配已通过校验的内置配置表。 | 已完成 |
| 3 | 导入并校验自定义 JSON 配置表。 | 已完成（基础版） |
| 4 | 实现分步交互式 Profile 向导。 | 已完成（第一版） |
| 5 | 根据向导结果生成可复用的配置表文件。 | 规划中 |
| 6 | 真机验证后升级为内置或共享配置表。 | 规划中 |

AOC U27P10 使用视频链路 DDC/CI，现场验证步骤见
[docs/aoc-u27p10-field-test.md](docs/aoc-u27p10-field-test.md)。

USB HID 报文封装可能因厂商而异，因此配置表只能引用软件内置的命名适配器，不能自行
注入底层报文或程序路径。当前内置 `lg-monitor-controls-v1`；增加其他厂商时先实现并审计
对应适配器，再由配置表完成型号匹配和 VCP 路由。

显示器硬件访问集中在 `sidecar/`。Sidecar 随 Desktop 构建和发布，运行时无需另外安装
DDC 控制工具。

### 配置表字段

配置表是 Desktop 与显示器硬件适配层之间的声明式契约，不包含可执行命令。一个完整配置
由识别条件、承载路径优先级、USB HID 映射和视频链路 DDC/CI 映射组成。

| 字段 | 含义 |
| --- | --- |
| `id` | 配置的稳定标识，只允许小写字母、数字和连字符，长度为 2–64。用户配置与内置配置同名时，以用户配置为准。 |
| `name` | 面向用户显示的型号名称，最长 80 个字符。 |
| `fallback` | 可选。设为 `true` 表示没有匹配到专用型号时使用的通用配置。 |
| `match.displayNamePattern` | 可选、不区分大小写的正则表达式，用于匹配操作系统报告的显示器名称，最长 120 个字符。 |
| `match.usbHid.vendorId` | 可选的 USB Vendor ID，使用十进制整数 `0–65535`。 |
| `match.usbHid.productId` | 可选的 USB Product ID，使用十进制整数 `0–65535`。VID/PID 必须同时匹配。 |
| `transports` | 整台显示器的承载路径优先级，至少包含一项且不能重复。亮度、音量、静音和输入源共用最终确认的同一条路径。 |
| `usbHid` | 当 `transports` 包含 `usb-hid-ddc` 时必填，描述已内置 USB HID 适配器及其 VCP 映射。 |
| `ddc` | 当 `transports` 包含 `video-ddc` 时必填，描述视频链路上的输入源读写编码。 |

Desktop 先探测 USB HID 和视频链路 DDC/CI 是否真正可用，再按 `transports` 从左到右
确认一条全局控制路径。亮度、音量、静音、输入源和状态回读全部使用这条路径，不会为不同
参数分别选路。当前路径失效并确认下一条路径可用后，整台显示器一起切换。可用路径只有：

- `usb-hid-ddc`：通过显示器的 USB HID 控制接口承载 DDC/CI；
- `video-ddc`：通过 HDMI、DisplayPort 或 USB-C 视频链路承载 DDC/CI。

`usbHid` 对象字段：

| 字段 | 含义 |
| --- | --- |
| `adapter` | USB 报文封装适配器。目前只接受内置的 `lg-monitor-controls-v1`。 |
| `vcp` | 四项能力对应的 8 位 VCP opcode，JSON 中写十进制 `0–255`。 |
| `inputWriteMode` | `vcp` 表示用输入源 VCP 及 `inputWriteValues` 写入；`vendor-private` 表示调用该适配器内置的厂商输入切换命令。 |
| `inputReadValues` | 将 USB HID 路径读取到的原始输入源值转换成 Desktop 的逻辑输入源。读取编码与写入编码相互独立。 |
| `inputWriteValues` | `vcp` 写入模式必填，将 `dp1`、`hdmi1`、`hdmi2`、`usbc` 转换成 VCP 写入值；厂商命令模式可以省略。 |

`ddc` 对象字段：

| 字段 | 含义 |
| --- | --- |
| `inputReadValues` | 将显示器读取到的原始输入源值转换成 Desktop 的逻辑输入源。JSON 对象键是原始数值的十进制字符串。 |
| `inputWriteValues` | 将 `dp1`、`hdmi1`、`hdmi2`、`usbc` 转换成写给显示器的原始值。值使用十进制字符串，写入时转换为整数。 |
| `inputWriteFeature` | 输入源写入编码族：`input` 表示标准输入源编码，`input-alt` 表示厂商替代编码。当前 Rust Sidecar 均通过 VCP `0x60` 写入，实际差异由 `inputWriteValues` 表达。 |

读取值与写入值是两个独立映射。部分显示器在 Get VCP、Set VCP、USB HID 和视频链路上
使用不同编码，甚至会返回超出标准 MCCS 表的值，因此不能把 `inputReadValues` 反转后直接
用于写入。所有非标准值都应从真实硬件的稳定回读和写入测试中取得。

### LG 32UQ85R 配置说明

`desktop/profiles/lg-32uq85r.json` 可以这样理解：

- `displayNamePattern` 匹配系统报告的 `LG … 32UQ85…`；USB `1086:39481` 对应十六进制
  VID/PID `043E:9A39`，任一识别条件匹配即可选择这份专用配置；
- `transports` 优先确认 `usb-hid-ddc`，不可用时整台显示器切换到 `video-ddc`；
- USB HID 路径使用 `lg-monitor-controls-v1` 封装，`16`、`98`、`141`、`96` 分别是
  VCP `0x10`、`0x62`、`0x8D`、`0x60`；
- 输入切换使用 LG 厂商命令，而 USB 路径的输入源回读值由独立的 `inputReadValues` 解码；
- 视频 DDC/CI 路径会把读取到的 `15`、`17`、`18`、`27`、`3840` 转换成界面使用的
  输入源名称；写入则采用 `208`、`144`、`145`、`210` 这组经硬件验证的替代编码；
- 同一个原始值在通用配置与专用配置中可能有不同含义，专用配置应以对应型号的真实行为为准。

### 增加显示器型号

1. 复制 `desktop/profiles/generic-ddc.json`，使用新的稳定 `id` 命名文件；
2. 记录操作系统显示器名称，并通过 USB 枚举确认十六进制 VID/PID，再转换成 JSON 十进制；
3. 分别测试亮度、音量、静音、输入源在 USB HID 和视频 DDC/CI 上的读写能力；
4. 按整条链路的可靠性填写 `transports`，不要声明未经完整测试的路径；
5. 对每个输入源分别记录读取原始值与成功写入值，不要假定二者相同；
6. 在 Desktop 设置中导入配置并查看本地诊断日志，确认写入后的回读值和实际显示器状态一致；
7. 提交内置配置前，应在断开 USB、切换视频口、睡眠唤醒和重启后重新验证回退行为。

配置加载器会拒绝非法 ID、过长名称或正则、未知路径、越界 VID/PID 和 VCP opcode，以及
未内置的 USB HID 适配器。配置文件不能指定程序、命令参数、动态库或网络地址。

## 本地诊断日志

每次显示器参数调整都会写入操作来源、参数、目标值、DDC/CI 承载路径、回读结果、耗时和
失败原因。日志文件为 Electron 系统日志目录下的 `azoria-desktop.jsonl`，单文件最多
2 MB，并保留三份轮转历史。日志不记录 Wi‑Fi 密码、本机密钥、设备 MAC 或完整固件路径，
也不会上传到网络。

## 许可证

本项目按 [GPL-3.0-or-later](LICENSE) 发布。GPL 允许商业使用、修改、分发和销售，
但衍生作品必须遵守 GPL 的相应义务。第三方库、硬件、商标和图标仍受各自权利人约束。
