/*
 * AZORIA Touch enclosure — first fit prototype
 * Target: VIEWE UEDX48480040E-WB-A V1.3, 94 x 94 mm PCBA.
 *
 * Export with OpenSCAD, for example:
 *   openscad -o azoria-touch-front.stl -D 'part="front"' azoria-touch-case.scad
 *
 * This first revision intentionally uses broad side openings so USB-C, TF and
 * the edge buttons remain reachable even when connector placement varies a
 * little between board revisions.
 */

$fn = 48;

part = "preview"; // [preview,layout,front,rear,fit_gauge]

// Official module envelope (millimetres).
board_size = 94;
board_thickness = 1.6;
glass_size = 84;
module_depth = 8.33;
mount_hole_spacing = 87;
mount_hole_diameter = 3;

// Printer and fit tuning.
xy_clearance = 0.35;       // clearance on each side of the PCB
wall = 2.4;
front_skin = 2.4;
case_depth = 15.5;
outer_corner_radius = 6;
window_size = 82;         // 1 mm overlap on each edge of the 84 mm glass
window_corner_radius = 3;

// Rear cover tuning. Increase pad_height if the board rattles after assembly.
lid_clearance = 0.18;
lid_thickness = 2.2;
lid_lip_height = 1.8;
pad_height = 2.2;
friction_rib = 0.30;

// Large revision-tolerant openings on the physical left and right edges.
port_opening_length = 72;
port_opening_front_offset = 5.0;

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
            rounded_prism(
                [pocket_size, pocket_size],
                max(outer_corner_radius - wall, 1),
                case_depth - front_skin + epsilon
            );

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
            translate([0, 0, lid_thickness])
                difference() {
                    rounded_prism(
                        [lid_size, lid_size],
                        max(outer_corner_radius - wall - lid_clearance, 1),
                        lid_lip_height
                    );
                    rounded_prism(
                        [lid_size - 2.2, lid_size - 2.2],
                        max(outer_corner_radius - wall - lid_clearance - 1.1, 0.8),
                        lid_lip_height + epsilon
                    );
                }

            // Small friction ribs: sand lightly if the first fit is too tight.
            for (rotation = [0, 90])
                rotate([0, 0, rotation])
                    for (side = [-1, 1])
                        translate([
                            side * (lid_size / 2 + friction_rib / 2 - epsilon),
                            0,
                            lid_thickness + lid_lip_height / 2
                        ])
                            cube([friction_rib, 18, lid_lip_height], center = true);

            // Pads bear on the PCB only around the official mounting holes.
            for (x = [-hole_offset, hole_offset])
                for (y = [-hole_offset, hole_offset])
                    translate([x, y, lid_thickness])
                        difference() {
                            cylinder(d = 6.2, h = pad_height);
                            translate([0, 0, -epsilon])
                                cylinder(d = mount_hole_diameter + 0.5,
                                         h = pad_height + 2 * epsilon);
                        }
        }

        ventilation_slots();
    }
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
                    rounded_prism(
                        [pocket_size, pocket_size],
                        1.5,
                        gauge_height + 2 * epsilon
                    );
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
}

module print_layout() {
    translate([-(outer_size / 2 + 4), 0, 0]) front_shell();
    translate([ (outer_size / 2 + 4), 0, 0]) rear_lid();
}

echo(str("PCB pocket: ", pocket_size, " x ", pocket_size, " mm"));
echo(str("Case outside: ", outer_size, " x ", outer_size, " x ", case_depth, " mm"));

if (part == "front") front_shell();
else if (part == "rear") rear_lid();
else if (part == "fit_gauge") fit_gauge();
else if (part == "layout") print_layout();
else assembly_preview();
