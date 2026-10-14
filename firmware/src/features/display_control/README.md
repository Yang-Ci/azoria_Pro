# 显示器控制功能

- `service.*`：被动响应 Desktop 发现、同步显示器状态，并通过 UDP 协调或 BLE
  提交带命令 ID 的控制操作；UDP 同时广播和单播到已发现的 Desktop，接收端按 ID 去重。
- `screen.*`：AZORIA Touch 的显示器控制界面与触控交互。

对外符号位于 `DisplayControl` 命名空间，其他模块不应引用本目录内部状态。

拖动过程发送的预览操作是尽力而为；松手后的最终操作等待 Desktop 确认，并在超时期间
以相同命令 ID 重发。Desktop 负责 Master 选择和重复命令缓存，Touch 不承担仲裁职责。

首页 `Codex / API` 与 `PC Status` 入口仅在按下后移动不超过 10 px 时响应点击；
一旦超出范围，即使滑回原位也不会进入页面。下拉背光面板会消耗当前触摸，
松手后需重新触摸才能操作面板或其他入口。使用 `python3 scripts/preview_controls.py`
（在 firmware 目录）验证真实 LVGL 触摸事件、下拉手势及滑块提交。
