#!/usr/bin/env python3
"""Generate AZORIA Touch V3 STEP files from parameterized B-rep geometry."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cadquery as cq


HERE = Path(__file__).resolve().parent

EPSILON = 0.05

BOARD_SIZE = 94.0
XY_CLEARANCE = 0.25
WALL = 2.4
FRONT_SKIN = 2.4
CASE_DEPTH = 15.5
OUTER_CORNER_RADIUS = 4.5
WINDOW_SIZE = 82.0
WINDOW_CORNER_RADIUS = 3.0
PORT_OPENING_LENGTH = 72.0
FRONT_NUT_POCKET_ACROSS_FLATS = 5.7
FRONT_NUT_POCKET_DEPTH = 1.8
FRONT_SCREW_CLEARANCE = 3.2

LID_CLEARANCE = 0.12
LID_THICKNESS = 2.2
LID_LIP_HEIGHT = 1.8
PAD_HEIGHT = 2.55
FRICTION_RIB = 0.35
MOUNT_HOLE_SPACING = 87.0
MOUNT_HOLE_DIAMETER = 3.0

USB_OPENING_DOWN_SHIFT = 4.0
USB_CENTER_FROM_TOP = (17.33, 31.72)
USB_NOTCH_WIDTH = 11.0
USB_NOTCH_DEPTH = 11.5
USB_PRINT_SIDE = -1

STAND_ANGLE = 10.0
STAND_BASE_WIDTH = 76.0
STAND_BASE_FRONT = 42.0
STAND_BASE_REAR = 18.0
STAND_BASE_THICKNESS = 4.0
STAND_BACK_WIDTH = 70.0
STAND_BACK_HEIGHT = 82.0
STAND_BACK_THICKNESS = 4.0
STAND_GUSSET_WIDTH = 6.0

FRAME_ANGLE = 15.0
FRAME_WIDTH = 60.0
FRAME_HEIGHT = 98.0
FRAME_REAR_FOOT = 75.0
FRAME_CASE_BACK_OFFSET = 14.0
FRAME_SHELF_DEPTH = 28.0
FRAME_SHELF_THICKNESS = 6.0
FRAME_FRONT_LIP_HEIGHT = 11.0

POCKET_SIZE = BOARD_SIZE + 2 * XY_CLEARANCE
OUTER_SIZE = POCKET_SIZE + 2 * WALL
LID_SIZE = POCKET_SIZE - 2 * LID_CLEARANCE
HOLE_OFFSET = MOUNT_HOLE_SPACING / 2


def rounded_prism(
    width: float,
    depth: float,
    height: float,
    radius: float,
    z: float = 0.0,
) -> cq.Workplane:
    if radius <= 0:
        return (
            cq.Workplane("XY", origin=(0.0, 0.0, z))
            .box(width, depth, height, centered=(True, True, False))
        )
    return (
        cq.Workplane("XY", origin=(0.0, 0.0, z))
        .box(
            width,
            depth,
            height,
            centered=(True, True, False),
        )
        .edges("|Z")
        .fillet(radius)
    )


def hex_nut_pocket(width: float, depth: float, z: float) -> cq.Workplane:
    circumradius = width / math.sqrt(3.0)
    points = []
    for index in range(6):
        angle = math.radians(30.0 + 60.0 * index)
        points.append(
            (circumradius * math.cos(angle), circumradius * math.sin(angle))
        )
    return (
        cq.Workplane("XY", origin=(0.0, 0.0, z))
        .polyline(points)
        .close()
        .extrude(depth)
    )


def front_shell() -> cq.Workplane:
    outer = rounded_prism(
        OUTER_SIZE, OUTER_SIZE, CASE_DEPTH, OUTER_CORNER_RADIUS
    )

    pocket = (
        cq.Workplane("XY", origin=(0.0, 0.0, FRONT_SKIN))
        .box(
            POCKET_SIZE,
            POCKET_SIZE,
            CASE_DEPTH - FRONT_SKIN + EPSILON,
            centered=(True, True, False),
        )
    )

    lead_in = (
        cq.Workplane("XY", origin=(0.0, 0.0, CASE_DEPTH - 1.0))
        .rect(POCKET_SIZE, POCKET_SIZE)
        .workplane(offset=1.0 + 2 * EPSILON)
        .rect(POCKET_SIZE + 0.8, POCKET_SIZE + 0.8)
        .loft(combine=True)
    )

    window = rounded_prism(
        WINDOW_SIZE,
        WINDOW_SIZE,
        FRONT_SKIN + 2 * EPSILON,
        WINDOW_CORNER_RADIUS,
        z=-EPSILON,
    )

    side_openings = []
    for side in (-1, 1):
        side_openings.append(
            cq.Workplane(
                "XY",
                origin=(
                    side * (OUTER_SIZE / 2 - WALL / 2),
                    0.0,
                    FRONT_SKIN,
                ),
            ).box(
                WALL + 2 * EPSILON,
                PORT_OPENING_LENGTH,
                CASE_DEPTH - FRONT_SKIN + 2 * EPSILON,
                centered=(True, True, False),
            )
        )

    result = outer.cut(pocket).cut(lead_in).cut(window)
    for opening in side_openings:
        result = result.cut(opening)

    for x in (-HOLE_OFFSET, HOLE_OFFSET):
        for y in (-HOLE_OFFSET, HOLE_OFFSET):
            result = result.cut(
                hex_nut_pocket(
                    FRONT_NUT_POCKET_ACROSS_FLATS,
                    FRONT_NUT_POCKET_DEPTH + EPSILON,
                    -EPSILON,
                ).translate((x, y, 0.0))
            )
            result = result.cut(
                cq.Workplane(
                    "XY",
                    origin=(
                        x,
                        y,
                        FRONT_NUT_POCKET_DEPTH - EPSILON,
                    ),
                )
                .circle(FRONT_SCREW_CLEARANCE / 2)
                .extrude(
                    FRONT_SKIN - FRONT_NUT_POCKET_DEPTH + 2 * EPSILON
                )
            )
    return result


def rear_lid() -> cq.Workplane:
    lid_radius = max(OUTER_CORNER_RADIUS - WALL - LID_CLEARANCE, 1.0)
    inner_lid_radius = max(lid_radius - 1.1, 0.8)

    plate = rounded_prism(
        LID_SIZE, LID_SIZE, LID_THICKNESS, lid_radius
    )

    lip_outer = rounded_prism(
        LID_SIZE,
        LID_SIZE,
        LID_LIP_HEIGHT + EPSILON,
        lid_radius,
        z=LID_THICKNESS - EPSILON,
    )
    lip_inner = rounded_prism(
        LID_SIZE - 2.2,
        LID_SIZE - 2.2,
        LID_LIP_HEIGHT + 2 * EPSILON,
        inner_lid_radius,
        z=LID_THICKNESS - EPSILON,
    )
    lip = lip_outer.cut(lip_inner)

    result = plate.union(lip)

    rib_center_z = LID_THICKNESS + LID_LIP_HEIGHT / 2 - EPSILON / 2
    rib_offset = LID_SIZE / 2 + FRICTION_RIB / 2 - EPSILON
    for side in (-1, 1):
        result = result.union(
            cq.Workplane("XY", origin=(side * rib_offset, 0.0, rib_center_z))
            .box(FRICTION_RIB, 18.0, LID_LIP_HEIGHT + EPSILON)
        )
        result = result.union(
            cq.Workplane("XY", origin=(0.0, side * rib_offset, rib_center_z))
            .box(18.0, FRICTION_RIB, LID_LIP_HEIGHT + EPSILON)
        )

    pad_holes = []
    for x in (-HOLE_OFFSET, HOLE_OFFSET):
        for y in (-HOLE_OFFSET, HOLE_OFFSET):
            result = result.union(
                cq.Workplane("XY", origin=(x, y, LID_THICKNESS - EPSILON))
                .circle(6.2 / 2)
                .extrude(PAD_HEIGHT + EPSILON)
            )
            pad_holes.append(
                cq.Workplane("XY", origin=(x, y, -EPSILON))
                .circle((MOUNT_HOLE_DIAMETER + 0.5) / 2)
                .extrude(LID_THICKNESS + PAD_HEIGHT + 2 * EPSILON)
            )

    ventilation = []
    for x in (-27, -18, -9, 0, 9, 18, 27):
        ventilation.append(
            cq.Workplane("XY", origin=(x, 0.0, -EPSILON))
            .slot2D(42.0, 3.2, angle=90)
            .extrude(LID_THICKNESS + 2 * EPSILON)
        )

    opening_length = (
        USB_CENTER_FROM_TOP[1]
        - USB_CENTER_FROM_TOP[0]
        + USB_NOTCH_WIDTH
    )
    from_top = (
        (USB_CENTER_FROM_TOP[0] + USB_CENTER_FROM_TOP[1]) / 2
        + USB_OPENING_DOWN_SHIFT
    )
    usb_cutout = cq.Workplane(
        "XY",
        origin=(
            USB_PRINT_SIDE * (LID_SIZE / 2 - USB_NOTCH_DEPTH / 2),
            BOARD_SIZE / 2 - from_top,
            -EPSILON,
        ),
    ).box(
        USB_NOTCH_DEPTH + FRICTION_RIB + 2.0,
        opening_length,
        LID_THICKNESS + LID_LIP_HEIGHT + PAD_HEIGHT + 2 * EPSILON,
        centered=(True, True, False),
    )

    result = result.cut(usb_cutout)
    for hole in pad_holes:
        result = result.cut(hole)
    for slot in ventilation:
        result = result.cut(slot)
    return result


def yz_prism(points: list[tuple[float, float]], width: float) -> cq.Workplane:
    return (
        cq.Workplane("YZ", origin=(-width / 2, 0.0, 0.0))
        .polyline(points)
        .close()
        .extrude(width)
    )


def desktop_dock_stand() -> cq.Workplane:
    base = rounded_prism(
        STAND_BASE_WIDTH,
        STAND_BASE_FRONT + STAND_BASE_REAR,
        STAND_BASE_THICKNESS,
        4.0,
    ).translate((0.0, (STAND_BASE_FRONT - STAND_BASE_REAR) / 2, 0.0))

    back_plate = (
        cq.Workplane("XY")
        .box(
            STAND_BACK_WIDTH,
            STAND_BACK_THICKNESS,
            STAND_BACK_HEIGHT,
            centered=(False, False, False),
        )
        .rotate((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), STAND_ANGLE)
        .translate((-STAND_BACK_WIDTH / 2, 0.0, STAND_BASE_THICKNESS - EPSILON))
    )

    front_lip = yz_prism(
        [
            (STAND_BASE_FRONT - 10.0, STAND_BASE_THICKNESS - EPSILON),
            (STAND_BASE_FRONT, STAND_BASE_THICKNESS - EPSILON),
            (STAND_BASE_FRONT, STAND_BASE_THICKNESS + 4.0),
            (STAND_BASE_FRONT - 4.0, 12.0),
            (STAND_BASE_FRONT - 10.0, STAND_BASE_THICKNESS + 6.0),
        ],
        STAND_BASE_WIDTH - 4.0,
    )

    result = base.union(back_plate).union(front_lip)
    for x in (
        -STAND_BACK_WIDTH / 2 + STAND_GUSSET_WIDTH / 2,
        STAND_BACK_WIDTH / 2 - STAND_GUSSET_WIDTH / 2,
    ):
        gusset = yz_prism(
            [
                (-9.0, STAND_BASE_THICKNESS - EPSILON),
                (7.0, STAND_BASE_THICKNESS - EPSILON),
                (-3.0, 24.0),
            ],
            STAND_GUSSET_WIDTH,
        ).translate((x, 0.0, 0.0))
        result = result.union(gusset)
    return result


def desktop_frame_stand() -> cq.Workplane:
    frame_top_depth = FRAME_CASE_BACK_OFFSET + FRAME_HEIGHT * math.tan(
        math.radians(FRAME_ANGLE)
    )

    outer = (
        cq.Workplane("XY")
        .polyline(
            [
                (FRAME_CASE_BACK_OFFSET, 0.0),
                (FRAME_REAR_FOOT, 0.0),
                (frame_top_depth, FRAME_HEIGHT),
            ]
        )
        .close()
        .extrude(FRAME_WIDTH)
    )
    inner = (
        cq.Workplane("XY")
        .polyline(
            [
                (FRAME_CASE_BACK_OFFSET + 6.0, FRAME_SHELF_THICKNESS),
                (FRAME_REAR_FOOT - 7.0, FRAME_SHELF_THICKNESS),
                (frame_top_depth + 2.5, FRAME_HEIGHT - 12.0),
            ]
        )
        .close()
        .extrude(FRAME_WIDTH)
    )

    shelf = (
        cq.Workplane("XY", origin=(-5.0, 0.0, 0.0))
        .box(
            FRAME_SHELF_DEPTH + 5.0,
            FRAME_SHELF_THICKNESS,
            FRAME_WIDTH,
            centered=(False, False, False),
        )
    )
    front_lip = (
        cq.Workplane("XY", origin=(-5.0, 0.0, 0.0))
        .box(5.0, FRAME_FRONT_LIP_HEIGHT, FRAME_WIDTH, centered=(False, False, False))
    )

    return outer.cut(inner).union(shelf).union(front_lip)


def all_parts_layout(
    front: cq.Workplane,
    rear: cq.Workplane,
    dock: cq.Workplane,
    frame: cq.Workplane,
) -> cq.Compound:
    parts = [
        front.translate((-52.0, -53.5, 0.0)).val(),
        rear.translate((50.0, -53.5, 0.0)).val(),
        dock.translate((-45.0, 60.0, 0.0)).val(),
        frame.translate((12.0, 7.0, 0.0)).val(),
    ]
    return cq.Compound.makeCompound(parts)


def shape_metrics(shape: cq.Shape) -> dict[str, object]:
    bounding_box = shape.BoundingBox()
    return {
        "bbox_min": [bounding_box.xmin, bounding_box.ymin, bounding_box.zmin],
        "bbox_max": [bounding_box.xmax, bounding_box.ymax, bounding_box.zmax],
        "volume_mm3": shape.Volume(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=HERE)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    front = front_shell()
    rear = rear_lid()
    dock = desktop_dock_stand()
    frame = desktop_frame_stand()
    all_parts = all_parts_layout(front, rear, dock, frame)

    named_shapes: list[tuple[str, cq.Shape]] = [
        ("azoria-touch-front-v3", front.val()),
        ("azoria-touch-rear-v3", rear.val()),
        ("azoria-touch-stand-dock-v3", dock.val()),
        ("azoria-touch-stand-frame-v3", frame.val()),
        ("azoria-touch-all-v3", all_parts),
    ]

    exports: list[tuple[str, cq.Shape]] = []
    for stem, shape in named_shapes:
        exports.append((f"{stem}.step", shape))
        exports.append((f"{stem}.stl", shape))

    report: dict[str, dict[str, object]] = {}
    for filename, shape in exports:
        path = args.output_dir / filename
        export_type = (
            cq.exporters.ExportTypes.STEP
            if path.suffix.lower() == ".step"
            else cq.exporters.ExportTypes.STL
        )
        cq.exporters.export(shape, str(path), export_type)
        report[filename] = shape_metrics(shape)
        print(f"generated {path}")

    report_path = args.output_dir / "step-validation.json"
    report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"generated {report_path}")


if __name__ == "__main__":
    main()
