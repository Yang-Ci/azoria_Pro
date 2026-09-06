# AZORIA Touch 独立外壳（第一版）

适配 VIEWE `UEDX48480040E-WB-A V1.3` 4 英寸 480×480 模组。设计依据是厂家
V3.2 规格书中的 94×94 mm PCBA、84×84 mm 玻璃盖板、87×87 mm 安装孔中心距
和约 8.33 mm 最大组件深度。

第一版的目标是验证装配尺寸，不追求最小接口开孔。左右两侧采用宽开口，兼容 USB-C、
TF 卡槽和按键的小幅版本差异。确认实物位置后再把第二版开孔收紧。

## 文件

- `azoria-touch-case.scad`：参数化源文件；顶部 `part` 可选择导出的零件。
- `azoria-touch-fit-gauge.stl`：先打印的板边和四孔试片。
- `azoria-touch-front.stl`：前框与壳体。
- `azoria-touch-rear.stl`：通风压盖，摩擦配合。
- `azoria-touch-layout.stl`：前框和背盖的组合打印布局。

## 推荐顺序

1. 先打印 `azoria-touch-fit-gauge.stl`，把 PCB 放进环内并核对四个孔。
2. 如果过紧，把 SCAD 中 `xy_clearance` 从 `0.35` 增加到 `0.45`；如果明显晃动，减到
   `0.25`。
3. 试片通过后分别打印前框和背盖。
4. 在玻璃边缘与前框之间贴 0.2–0.5 mm 的薄泡棉或 Kapton 胶带，避免硬塑料直接压玻璃。
5. 从背面装入模组，再压入背盖。若背盖过紧，轻磨四条摩擦筋；若模组前后晃动，增加
   `pad_height` 或在四个环形压垫上贴薄泡棉。

## FDM 参数

- 材料：首版 PLA；长期放在高温机箱旁建议 PETG。
- 喷嘴：0.4 mm。
- 层高：0.20 mm。
- 壁线：3–4 道。
- 顶/底层：4 层。
- 填充：15–25%。
- 支撑：不需要。
- 前框：显示面朝下打印；建议启用 0.15–0.25 mm 象脚补偿。
- 背盖：平面朝下、压垫朝上打印。

完整外壳约为 99.5×99.5×15.5 mm，正面开窗 82×82 mm。切片前确认 STL 单位为毫米。

### Bambu Studio / A1

1. 在 Windows 的 Bambu Studio 中先导入 `azoria-touch-fit-gauge.stl`，单位选择毫米，
   缩放保持 `100%`。
2. 使用 A1 的 `0.20 mm Standard` 起始配置、普通 PLA、关闭支撑；首层不要使用会改变
   XY 尺寸的额外缩放。
3. 试片确认后，导入 `azoria-touch-front.stl` 和 `azoria-touch-rear.stl` 分开切片最稳妥；
   也可以使用已经排好的 `azoria-touch-layout.stl`。
4. 前框保持显示面朝下，背盖保持大平面朝下。切片预览中确认七条散热槽均贯通。

## 机械资料

- [厂家规格书](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display/blob/main/information/UEDX48480040E-WB-A%20V3.2%20SPEC.pdf)
- [厂家硬件仓库](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display)
