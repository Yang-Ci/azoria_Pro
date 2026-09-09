/*
 * AZORIA Touch enclosure — V3 tight-fit enclosure and desktop stand
 * Target: VIEWE UEDX48480040E-WB-A V1.3, 94 x 94 mm PCBA.
 *
 * Export with OpenSCAD, for example:
 *   openscad -o azoria-touch-front-v3.stl -D 'part="front"' azoria-touch-case.scad
 *
 * V3 tightens the PCB pocket, strengthens the rear-cover press fit, mirrors the
 * USB cut-outs into their installed position, and adds two desktop-stand
 * alternatives.
 */

$fn = 48;

part = "preview"; // [preview,all,layout,front,rear,stand_dock,stand_frame,fit_gauge]

// Official module envelope (millimetres).
board_size = 94;
board_thickness = 1.6;
glass_size = 84;
module_depth = 8.33;
mount_hole_spacing = 87;
mount_hole_diameter = 3;

// Printer and fit tuning.
// The V2 value was 0.60 mm per side and allowed the module to rattle.  A square
// pocket no longer needs that much compensation for the PCB corners.
xy_clearance = 0.25;       // clearance on each side of the PCB
wall = 2.4;
front_skin = 2.4;
case_depth = 15.5;
// A slightly tighter outside radius keeps useful wall thickness around the
// newly square PCB-pocket corners.
outer_corner_radius = 4.5;
window_size = 82;         // 1 mm overlap on each edge of the 84 mm glass
window_corner_radius = 3;

// Rear cover tuning. Increase pad_height if the board rattles after assembly.
lid_clearance = 0.12;
lid_thickness = 2.2;
lid_lip_height = 1.8;
// 15.5 - 2.4 - 8.33 - 2.2 = 2.57 mm nominal rear gap.  Leave 0.02 mm
// compression clearance; a 0.2 mm foam dot on each pad gives gentle preload.
pad_height = 2.55;
friction_rib = 0.35;

// Large revision-tolerant openings on the physical left and right edges.
port_opening_length = 72;
port_opening_front_offset = front_skin;

// USB locations from the official V3.2 back-view mechanical drawing.  The rear
// cover is modelled with its inside face up for support-free printing, so X is
// mirrored when it is flipped into the enclosure: print-left becomes the
// installed back-view right side.
usb_center_from_top = [17.33, 31.72];
usb_notch_width = 11.0;
usb_notch_depth = 11.5;
usb_installed_back_view_side = 1; // -1 = left, 1 = right
usb_print_side = -usb_installed_back_view_side;

// Separate one-piece desktop stand: flat base, inclined back plate and a raised
// front edge matching the supplied reference.  The small rear heel keeps the
// centre of gravity inside the footprint when the screen leans backward.
stand_angle = 10;
stand_base_width = 76;
stand_base_front = 42;
stand_base_rear = 18;
stand_base_thickness = 4;
stand_back_width = 70;
stand_back_height = 82;
stand_back_thickness = 4;
stand_front_lip_depth = 10;
stand_front_lip_height = 12;
stand_gusset_width = 6;

// Alternate full-width triangular frame.  This version uses more material but
// gives the widest rear footprint and the best resistance to side loads.
frame_angle = 15;
frame_width = 60;
frame_height = 98;
frame_rear_foot = 75;
frame_case_back_offset = 14;
frame_shelf_depth = 28;
frame_shelf_thickness = 6;
frame_front_lip_height = 11;

pocket_size = board_size + 2 * xy_clearance;
outer_size = pocket_size + 2 * wall;
lid_size = pocket_size - 2 * lid_clearance;
hole_offset = mount_hole_spacing / 2;
epsilon = 0.05;

module rounded_rect_2d(size, radius) {
    offset(r = radius)
        square([size[0] - 2 * radius, size[1] - 2 * radius], center = true);
}

module rounded_prism(size, radius, height) {
    linear_extrude(height = height)
        rounded_rect_2d(size, radius);
}

// A square PCB needs square internal clearance. A rounded pocket with the same
// nominal width becomes much smaller at its corners and prevents insertion even
// when every mounting hole is correctly located.
module square_pocket(height) {
    linear_extrude(height = height)
        square([pocket_size, pocket_size], center = true);
}

module capsule_2d(length, width) {
    hull() {
        translate([-(length - width) / 2, 0]) circle(d = width);
        translate([ (length - width) / 2, 0]) circle(d = width);
    }
}

module front_shell() {
    difference() {
        rounded_prism([outer_size, outer_size], outer_corner_radius, case_depth);

        // Module pocket, open from the back.
        translate([0, 0, front_skin])
            square_pocket(case_depth - front_skin + epsilon);

        // A short lead-in at the rear removes the sharp printed entry edge and
        // gives another 0.4 mm per side while the PCB is being aligned.
        translate([0, 0, case_depth - 1.0])
            linear_extrude(
                height = 1.0 + 2 * epsilon,
                scale = (pocket_size + 0.8) / pocket_size
            )
                square([pocket_size, pocket_size], center = true);

        // Touch/display opening.
        translate([0, 0, -epsilon])
            rounded_prism(
                [window_size, window_size],
                window_corner_radius,
                front_skin + 2 * epsilon
            );

        // Broad side access openings. Corner pillars remain for stiffness.
        for (side = [-1, 1])
            translate([
                side * (outer_size / 2 - wall / 2),
                0,
                port_opening_front_offset + (case_depth - port_opening_front_offset) / 2
            ])
                cube(
                    [wall + 2 * epsilon, port_opening_length,
                     case_depth - port_opening_front_offset + 2 * epsilon],
                    center = true
                );
    }
}

module ventilation_slots() {
    for (x = [-27, -18, -9, 0, 9, 18, 27])
        translate([x, 0, -epsilon])
            linear_extrude(height = lid_thickness + 2 * epsilon)
                rotate(90)
                    capsule_2d(42, 3.2);
}

module rear_lid() {
    difference() {
        union() {
            rounded_prism(
                [lid_size, lid_size],
                max(outer_corner_radius - wall - lid_clearance, 1),
                lid_thickness
            );

            // Shallow locating lip on the enclosure-facing side.
            translate([0, 0, lid_thickness - epsilon])
                difference() {
                    rounded_prism(
                        [lid_size, lid_size],
                        max(outer_corner_radius - wall - lid_clearance, 1),
                        lid_lip_height + epsilon
                    );
                    rounded_prism(
                        [lid_size - 2.2, lid_size - 2.2],
                        max(outer_corner_radius - wall - lid_clearance - 1.1, 0.8),
                        lid_lip_height + 2 * epsilon
                    );
                }

            // Small friction ribs: sand lightly if the first fit is too tight.
            for (rotation = [0, 90])
                rotate([0, 0, rotation])
                    for (side = [-1, 1])
                        translate([
                            side * (lid_size / 2 + friction_rib / 2 - epsilon),
                            0,
                            lid_thickness + lid_lip_height / 2 - epsilon / 2
                        ])
                            cube([
                                friction_rib,
                                18,
                                lid_lip_height + epsilon
                            ], center = true);

            // Pads bear on the PCB only around the official mounting holes.
            for (x = [-hole_offset, hole_offset])
                for (y = [-hole_offset, hole_offset])
                    translate([x, y, lid_thickness - epsilon])
                        difference() {
                            cylinder(d = 6.2, h = pad_height + epsilon);
                            translate([0, 0, -epsilon])
                                cylinder(d = mount_hole_diameter + 0.5,
                                         h = pad_height + 3 * epsilon);
                        }
        }

        ventilation_slots();

        // Two compact edge cut-outs retain much more lid material than V2's
        // single 42 x 15 mm opening while clearing both Type-C shells/plugs.
        for (from_top = usb_center_from_top)
            translate([
                usb_print_side * (lid_size / 2 - usb_notch_depth / 2),
                board_size / 2 - from_top,
                (lid_thickness + lid_lip_height + pad_height) / 2
            ])
                cube([
                    usb_notch_depth + friction_rib + 2,
                    usb_notch_width,
                    lid_thickness + lid_lip_height + pad_height + 2 * epsilon
                ], center = true);
    }
}

// Extrude a depth/height (Y/Z) profile across X.  This keeps the lip and the
// two gussets as simple printable prisms rather than unsupported cylinders.
module yz_profile_prism(width, x_center = 0) {
    multmatrix([
        [0, 0, 1, x_center - width / 2],
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 0, 1]
    ])
        linear_extrude(height = width)
            children();
}

module desktop_dock_stand() {
    union() {
        // Wide rounded footprint, printed directly on this face.
        translate([0, (stand_base_front - stand_base_rear) / 2, 0])
            rounded_prism(
                [stand_base_width, stand_base_front + stand_base_rear],
                4,
                stand_base_thickness
            );

        // The back plate tilts away from the viewer.  Ten degrees is enough to
        // steady the display without making the footprint excessively deep.
        translate([
            -stand_back_width / 2,
            0,
            stand_base_thickness - epsilon
        ])
            rotate([stand_angle, 0, 0])
                cube([
                    stand_back_width,
                    stand_back_thickness,
                    stand_back_height
                ]);

        // Chamfered front retaining edge, visually close to the rolled edge in
        // the reference but safe to print without support.
        yz_profile_prism(stand_base_width - 4)
            polygon([
                [stand_base_front - stand_front_lip_depth,
                 stand_base_thickness - epsilon],
                [stand_base_front, stand_base_thickness - epsilon],
                [stand_base_front, stand_base_thickness + 4],
                [stand_base_front - 4, stand_front_lip_height],
                [stand_base_front - stand_front_lip_depth,
                 stand_base_thickness + 6]
            ]);

        // Two local triangular ribs reinforce the high-stress back/base joint.
        for (x = [
            -stand_back_width / 2 + stand_gusset_width / 2,
             stand_back_width / 2 - stand_gusset_width / 2
        ])
            yz_profile_prism(stand_gusset_width, x)
                polygon([
                    [-9, stand_base_thickness - epsilon],
                    [ 7, stand_base_thickness - epsilon],
                    [-3, 24]
                ]);
    }
}

module frame_stand_side_profile_2d() {
    frame_top_depth = frame_case_back_offset
                      + frame_height * tan(frame_angle);

    union() {
        difference() {
            polygon([
                [frame_case_back_offset, 0],
                [frame_rear_foot, 0],
                [frame_top_depth, frame_height]
            ]);
            polygon([
                [frame_case_back_offset + 6, frame_shelf_thickness],
                [frame_rear_foot - 7, frame_shelf_thickness],
                [frame_top_depth + 2.5, frame_height - 12]
            ]);
        }

        translate([-5, 0])
            square([frame_shelf_depth + 5, frame_shelf_thickness]);
        translate([-5, 0])
            square([5, frame_front_lip_height]);
    }
}

module desktop_frame_stand() {
    // One triangular side is the print-bed face; the opening runs vertically
    // through the print, so this stronger alternative also needs no support.
    linear_extrude(height = frame_width)
        frame_stand_side_profile_2d();
}

module fit_gauge() {
    gauge_height = 2.6;
    tab_height = 0.8;
    ring_width = 2.0;

    difference() {
        union() {
            difference() {
                rounded_prism(
                    [pocket_size + 2 * ring_width, pocket_size + 2 * ring_width],
                    3.5,
                    gauge_height
                );
                translate([0, 0, -epsilon])
                    square_pocket(gauge_height + 2 * epsilon);
            }

            // Low connected tabs let the PCB sit inside the ring while
            // verifying the official 87 x 87 mm mounting pattern.
            for (x = [-hole_offset, hole_offset])
                for (y = [-hole_offset, hole_offset])
                    hull() {
                        translate([x, y, 0]) cylinder(d = 7.2, h = tab_height);
                        translate([
                            sign(x) * (pocket_size / 2 + ring_width / 2),
                            sign(y) * (pocket_size / 2 + ring_width / 2),
                            0
                        ]) cylinder(d = 2.2, h = tab_height);
                    }
        }

        for (x = [-hole_offset, hole_offset])
            for (y = [-hole_offset, hole_offset])
                translate([x, y, -epsilon])
                    cylinder(d = mount_hole_diameter + 0.3,
                             h = tab_height + 2 * epsilon);
    }
}

module module_placeholder() {
    color([0.05, 0.25, 0.55, 0.8])
        translate([0, 0, front_skin])
            cube([board_size, board_size, board_thickness], center = true);
    color([0.03, 0.03, 0.03, 0.9])
        translate([0, 0, front_skin - 0.2])
            cube([glass_size, glass_size, 0.8], center = true);
}

module assembly_preview() {
    color([0.88, 0.88, 0.9]) front_shell();
    module_placeholder();
    color([0.72, 0.72, 0.76])
        translate([0, 0, case_depth + 8]) rear_lid();

    // The stand is shown beside the exploded enclosure in its print/use
    // orientation: the broad base lies directly on the print bed.
    color([0.35, 0.38, 0.44, 0.8])
        translate([outer_size / 2 + 16, -stand_base_front / 2, 0])
            scale([0.45, 0.45, 0.45]) desktop_dock_stand();

    color([0.22, 0.28, 0.36, 0.65])
        translate([outer_size / 2 + 60, -frame_rear_foot / 2, 0])
            scale([0.32, 0.32, 0.32]) desktop_frame_stand();
}

module print_layout() {
    translate([-(outer_size / 2 + 4), 0, 0]) front_shell();
    translate([ (outer_size / 2 + 4), 0, 0]) rear_lid();
}

// Complete one-plate export: enclosure plus both stand alternatives.  The
// 199 x 208 mm footprint fits a 256 x 256 mm Bambu A1 plate with useful margin.
// The fit gauge is deliberately excluded.
module print_all_layout() {
    translate([-52, -53.5, 0]) front_shell();
    translate([ 50, -53.5, 0]) rear_lid();
    translate([-45,  60.0, 0]) desktop_dock_stand();
    translate([ 12,   7.0, 0]) desktop_frame_stand();
}

echo(str("PCB pocket: ", pocket_size, " x ", pocket_size, " mm"));
echo(str("Case outside: ", outer_size, " x ", outer_size, " x ", case_depth, " mm"));
echo(str("Installed USB side: ", usb_installed_back_view_side == 1 ? "right" : "left"));
echo(str("Dock/frame stand angles: ", stand_angle, "/", frame_angle, " degrees"));

if (part == "front") front_shell();
else if (part == "rear") rear_lid();
else if (part == "stand" || part == "stand_dock") desktop_dock_stand();
else if (part == "stand_frame") desktop_frame_stand();
else if (part == "fit_gauge") fit_gauge();
else if (part == "all") print_all_layout();
else if (part == "layout") print_layout();
else assembly_preview();
