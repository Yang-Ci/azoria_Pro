# AOC U27P10 现场验证指南

这份指南用于验证 AOC U27P10 是否可以稳定使用 AZORIA 的“视频链路 → DDC/CI”控制路径。AOC U27P10 未采用 LG 32UQ85R 那类已内置的 USB HID 封装，因此不要测试或启用 `usb-hid-ddc`；AOC 固件升级也不在 AZORIA 的管理范围内。

## 目标

- 确认直连视频线上的 DDC/CI 可以读写；
- 确认亮度、音量、静音和输入源各自是否受支持；
- 记录 AOC U27P10 输入源的读取值和写入值；
- 如映射与内置配置不同，修正 `desktop/profiles/aoc-u27p10.json`。

## 接线

1. 优先把主机直连到显示器的 DisplayPort；没有合适 DP 线时也可以用 HDMI。
2. 不要让视频信号经过集线器、扩展坞、KVM、转换器或无线投屏器。EDID 能被读到不代表 DDC/CI 一定能双向通信。
3. AOC 的 USB 上行线不是必需品。此方案不依赖 USB HID。
4. 在 AOC 的 OSD 菜单中确认 DDC/CI 已开启，并让显示器处于当前正在测试的输入源。

DDC/CI 使用视频线上的 I2C 通道，不能通过 HTTP 隧道转发。AZORIA Desktop 和 sidecar 必须运行在物理连接这台显示器的主机上。远程桌面或 SSH 可以用来操作那台主机，但不能替代本机 DDC/CI 访问。

## 命令行验证

以下命令在连接 AOC 的 Linux 主机上执行。

```bash
sudo apt install ddcutil i2c-tools
sudo usermod -aG i2c "$USER"
```

加入 `i2c` 组后要重新登录或重启。确认组生效：

```bash
groups
ddcutil detect
```

`ddcutil detect` 应显示 AOC U27P10，并能完成 DDC/CI 通信。如果只显示 EDID 而报告 `DDC communication failed`，优先排查视频链路，而不是修改 profile。

查看能力并读取状态：

```bash
ddcutil capabilities
ddcutil getvcp 0x10
ddcutil getvcp 0x60
ddcutil getvcp 0x62
ddcutil getvcp 0x8d
```

`0x10` 是亮度，`0x60` 是输入源，`0x62` 是音量，`0x8d` 是静音。某项能力不受支持时，`capabilities` 或对应 `getvcp` 会给出明确失败；这不会影响其他能力。

先做亮度往返测试：

```bash
ddcutil setvcp 0x10 40
ddcutil getvcp 0x10
ddcutil setvcp 0x10 60
ddcutil getvcp 0x10
```

如果显示器实际亮度变化且回读值稳定，说明视频链路 DDC/CI 可用。

## 输入源映射

输入源的读取值和写入值可能不同，不能把读取值直接反转后当作写入值。测试前先确认有物理输入可用，并避免在唯一显示器被切走后无法操作主机。

推荐流程：

1. 用显示器物理菜单切到某个输入源；
2. 执行 `ddcutil getvcp 0x60`，记录当前值；
3. 用 `ddcutil setvcp 0x60 <候选值>` 写入一个候选值；
4. 观察显示器是否实际切换，再回读确认；
5. 对 DP、HDMI1、HDMI2 和 USB-C 分别记录结果。

常见候选值如下：

| 输入 | 读取候选 | 写入候选 |
| --- | ---: | ---: |
| DisplayPort | 15、16 | 15、16 |
| HDMI 1 | 17 | 17 |
| HDMI 2 | 18 | 18 |
| USB-C | 27、3840 | 27 |

如果某个输入源写入失败，先看 `ddcutil capabilities` 中 `0x60` 支持的值，再尝试相邻的厂商编码。记录最终能切换的值，并把读取值和写入值分别更新到 `desktop/profiles/aoc-u27p10.json`。

配置中的数字必须写十进制字符串：

```json
{
  "inputReadValues": {
    "15": "dp1"
  },
  "inputWriteValues": {
    "dp1": "15"
  }
}
```

## AZORIA 验证

在连接显示器的主机上构建并启动 Desktop：

```bash
npm install
npm run sidecar:build
npm run dev
```

界面应显示 `AOC U27P10` 配置档，且可用路径为 `视频链路 → DDC/CI`。依次测试亮度、音量、静音和输入源，并确认回读值与显示器实际状态一致。

也可以直接调用 sidecar 做最小验证：

```bash
sidecar/target/release/azoria-ddc-sidecar '{"operation":"enumerate"}'
sidecar/target/release/azoria-ddc-sidecar '{"operation":"get","transport":"native-ddc","display":1,"vcp":16}'
```

如果 Desktop 显示“未检测到显示器”或选择了通用配置，先检查 `enumerate` 是否返回 `AOC` 和 `U27P10`。如果 sidecar 的 `get` 正常而 Desktop 不可用，再查看 Electron 日志目录下的 `azoria-desktop.jsonl`。

## 常见失败

### 2026-09-06 Linux 亮度延迟优化

Desktop 复用已工作的 DDC 路径；后台亮度查询改为每 5 秒一次，交互期间暂停，完整状态查询在控制项之间让路。队列中的过期拖动预览会合并；同来源、同路径、两秒内成功写入的相同预览值，松手时只回读确认，避免再次写入。最终值改变时仍执行写入和回读，回读不一致仍报错。心跳检查复用最近成功的 DDC 操作，减少重复探测。

通过 Electron IPC 调用真实 AOC U27P10 的亮度控制，三轮结果：

| 操作 | 耗时 |
| --- | --- |
| 相同值松手确认 | 662–665 ms |
| 最终值改变：写入及回读 | 1207–1273 ms |
| 预览写入 | 487–617 ms；首轮碰到后台读取为 1157 ms |

测试后恢复原亮度。以上是 Desktop 至显示器的调用耗时，不包含手指操作和 Touch 网络传输。测量后进一步将后台周期从 2 秒降为 5 秒，并在第二次稳定性读取前检查待处理控制；已开始的 DDC 事务无法中途取消。`control.dequeued.queueMs` 单独记录排队时间，`control.success.reusedPreview` 标识是否复用了预览写入。

回归检查：`node --test desktop/tests/monitor-latency.test.cjs`。覆盖预览合并、相同值去重、不同最终值、失败重试、回读不一致和后台查询让路。

| 现象 | 优先排查 |
| --- | --- |
| EDID 可见但 DDC 通信失败 | 改为直连 DP/HDMI，移除 hub、KVM、转换器；确认 DDC/CI 开关 |
| 读取正常但写入无效 | 确认 VCP 能力，检查显示器 OSD 是否锁定，换一条支持 DDC 的线 |
| 输入源写入后回读不变 | 记录实际切换成功的厂商值，修正 profile 写入映射 |
| Desktop 在远程机不可用 | Desktop 必须运行在物理连接显示器的主机上 |
| 某个控制无响应 | 该 VCP 能力可能未开放；保留失败记录，不影响其他控制 |

## 通过标准

- `ddcutil detect` 能稳定识别 AOC U27P10；
- 亮度写入和回读均成功；
- 每个可用的输入源都有已验证的读取值和写入值；
- Desktop 显示 AOC 专用配置档和 `视频链路 → DDC/CI`；
- 断开重连、睡眠唤醒和重启后控制仍能恢复。
