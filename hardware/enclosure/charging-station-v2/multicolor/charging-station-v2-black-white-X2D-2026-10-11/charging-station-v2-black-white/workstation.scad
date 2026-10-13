// CUKTECH AD1204U + four retractable cables + YangCi Touch.
// Original prototype based on user photographs; NOT a downloaded station model.
// Units: mm. Official AD1204U dimensions: 67 x 76 x 33 mm (2026-10-03).
// CAD validation is separate from physical fit / thermal validation.
use <azoria-touch-v3-source.scad>

$fn = 36;
part = "assembly"; // See README for print parts and validation modes.
version = "hinge"; // hinge, flat
angle = 60; // Screen surface measured from horizontal desk, allowed 0..75.
show_components = true;

// Intact charger lies flat: NARROW 76 x 33 LCD side toward front, USB edge right.
// X width 76, Y depth 67, Z height 33. Add 0.2mm to official dimensions.
charger_size = [76.2,67.2,33.2];
charger_pos = [11,5.5,5.2];
charger_gap = 1.0;
reel_size = [50,60,15];
reel_x = [116,174];
reel_z = [6,25];
reel_y = 5.2;
slot_w = 52;
slot_h = 17;
reel_rack_end = 66;
// No claim of 4x240W total output; channel 4 is connected to the charger's USB-A.
body_w = 236;
body_d = 120;
body_h = 46;
wall = 2.8;
floor_t = 3;
lid_t = 2.4;
corner = 6;
body_top = body_h-lid_t;
screw_xy = [[5.8,5.8],[body_w-5.8,5.8],[5.8,body_d-5.8],[body_w-5.8,body_d-5.8]];

screen_side = 99.3;
screen_half = screen_side/2;
screen_depth = 15.5;
screen_cx = 168;
screen_front = 14;
pivot_y = 9;
pivot_z = body_h+11;
moving_axis_y = -5;
moving_axis_z = 7.75;
pivot_hole = 4.4; // M4 x 25 bolts, washers + locking thumb nuts, not printed pins.
moving_outer_x = 56.5;
fixed_ear_x = 61;
fixed_ear_w = 7;
retainer_screws = [[111,10],[231,10],[111,38],[231,38]];
// 3.1mm of panel remains between the outer clearance holes and the side edge.
rear_screws_x = [10,94,226];
rear_screws_z = [10,37];
rear_head_d = 6.4;
rear_head_depth = 1.5; // Countersunk M3 heads sit flush beneath service cover.
ac_screws_x = [16,81]; // Keep cover pilots clear of the rear-panel screw seats.
ac_screws_z = [6,40];
touch_exit_x = 207;
touch_exit_w = 12;
touch_exit_bottom = 35;
socket_pos = [14,72.7,6];
socket_size = [64,39,31]; // whole female connector incl. mated original prongs; provisional
// This opening is an intentionally replaceable SERVICE COVER.
// Actual extension female connector + lead diameter must be checked before printing.
ac_window = [64,28];
ac_center = [46,23];
ac_wire_d = 8.5;
eps = 0.05;

assert(angle>=0 && angle<=75, "angle must be in 0..75 degrees.");
assert(version=="hinge" && part!="lid_flat", "Compact V2 exports adjustable model only; flat version deferred.");
assert(charger_pos[2]+charger_size[2] < body_top, "charger exceeds body height");
assert(screen_cx+fixed_ear_x+fixed_ear_w/2 < body_w-wall, "hinge exceeds body");

module rounded2(s,r=3) {
    translate([r,r]) offset(r=r) square([s[0]-2*r,s[1]-2*r]);
}
module roundbox(s,r=3) { linear_extrude(s[2]) rounded2([s[0],s[1]],r); }
module yhole(x,y,z,d,len) { translate([x,y,z]) rotate([-90,0,0]) cylinder(d=d,h=len); }
module xhole(x,y,z,d,len) { translate([x,y,z]) rotate([0,90,0]) cylinder(d=d,h=len); }

module chassis() {
    difference() {
        union() {
            difference() {
                roundbox([body_w,body_d,body_top],corner);
                translate([wall,wall,floor_t])
                    cube([body_w-2*wall,body_d-2*wall,body_top+1]);
                // Rear is a separate screwed service panel.
                translate([5,body_d-wall-0.4,floor_t])
                    cube([body_w-10,wall+1,body_top+1]);
            }
            for(p=screw_xy) translate([p[0],p[1],floor_t-eps])
                cylinder(d=8.4,h=body_top-floor_t+eps);
            // Continuous rails: upper shelf joins them; lower rails join base.
            for(x=reel_x) {
                for(s=[x-3.4,x+51])
                    translate([s,reel_y,floor_t-eps]) cube([2.4,62,42-floor_t+eps]);
                for(z=reel_z)
                    translate([x-3.4,reel_y,z-2.4]) cube([56.8,62,2.4]);
                // Front upper/lower retaining lips prevent the whole reel sliding
                // forward during a cable pull. 1mm overlap into its 15mm face.
                for(z=reel_z) for(zz=[z-1,z+14])
                    translate([x-3.4,wall-eps,zz])
                        cube([56.8,reel_y-wall+eps,2]);
            }
            // Mid-height gap leaves room for the charger's right-side USB plugs.
            // Each boss overlaps a continuous reel rail / outer side wall.
            for(p=retainer_screws) translate([p[0]-4,60,p[1]-4]) cube([8,6,8]);
            // Rear screw columns connect directly to the floor.
            for(x=rear_screws_x) translate([x-3.5,body_d-11,floor_t-eps])
                cube([7,8,body_top-floor_t+eps]);
            // Charger sits on four small feet and is held with hook-and-loop strap.
            for(x=[charger_pos[0],charger_pos[0]+charger_size[0]-7])
                for(y=[charger_pos[1],charger_pos[1]+charger_size[1]-7])
                    translate([x,y,floor_t-eps]) cube([7,7,charger_pos[2]-floor_t+eps]);
            // Low locator rails leave all charger ports and plug area accessible.
            for(x=[charger_pos[0]-3.4,charger_pos[0]+charger_size[0]+1])
                translate([x,charger_pos[1]-1,floor_t-eps])
                    cube([2.4,charger_size[1]+2,12-floor_t+eps]);
        }
        // Front open window keeps original photo's left-bay language.
        translate([9,-eps,4.4]) cube([80,wall+2*eps,36.4]);
        for(x=reel_x) for(z=reel_z)
            translate([x-1,wall+eps,z-1]) rotate([90,0,0])
                linear_extrude(wall+2*eps) rounded2([slot_w,slot_h],0.9);
        for(p=screw_xy) translate([p[0],p[1],body_top-10])
            cylinder(d=2.6,h=11);
        for(p=retainer_screws) yhole(p[0],59.8,p[1],2.6,7);
        for(x=rear_screws_x) for(z=rear_screws_z)
            yhole(x,body_d-12,z,2.6,11);
        // Bottom ventilation, only below charger; rails and supports stay intact.
        for(x=[24:7:76]) translate([x,28,-eps]) cube([3,18,floor_t+2*eps]);
        // Two strap slots in floor, outside charger envelope.
        for(x=[4,93]) translate([x,28,-eps]) cube([3,18,floor_t+2*eps]);
        translate([93,0.6,24.2]) rotate([90,0,0])
            linear_extrude(1) text("10",size=9,font="Liberation Sans",halign="left");
        translate([93,0.6,19]) rotate([90,0,0])
            linear_extrude(1) text("ULTRA",size=2.4,font="Liberation Sans",halign="left");
        // Subtle channel engraving: C1/C3 upper, C2/A lower.
        for(i=[0:3]) {
            xx=i%2==0 ? 107 : 168;
            zz=i<2 ? 31 : 12;
            label=i==0 ? "C1" : i==1 ? "C3" : i==2 ? "C2" : "A";
            translate([xx,0.6,zz]) rotate([90,0,0])
                linear_extrude(1) text(label,size=3.2,font="Liberation Sans",halign="left");
        }
    }
}

module deck_blank() {
    difference() {
        roundbox([body_w,body_d,lid_t],corner);
        for(p=screw_xy) translate([p[0],p[1],-eps]) cylinder(d=3.4,h=lid_t+2*eps);
        for(x=[18:7:79]) translate([x,12,-eps]) cube([2.8,67,lid_t+2*eps]);
    }
}
// Face-up form of project's proven V3 front shell; existing dimensions unchanged.
module screen_frame_up() {
    translate([0,screen_half,screen_depth]) rotate([180,0,0]) front_shell();
}
module flat_deck() {
    union() {
        difference() {
            deck_blank();
            translate([screen_cx-screen_half-0.1,screen_front-0.1,-eps])
                cube([screen_side+0.2,screen_side+0.2,lid_t+2*eps]);
        }
        // Overlapping rim joins V3 frame to plate without shrinking PCB cavity.
        translate([screen_cx,screen_front,-screen_depth+lid_t]) screen_frame_up();
        difference() {
            translate([screen_cx-screen_half-1,screen_front-1,0])
                cube([screen_side+2,screen_side+2,lid_t]);
            // Keep join edges away from coincident V3 pocket edges (CGAL triangulation).
            translate([screen_cx-47.5,screen_front+2.15,-eps])
                cube([95,95,lid_t+2*eps]);
        }
    }
}
module bearing_local(sign) {
    // Fixed ear and foot, axis along X.
    translate([screen_cx+sign*fixed_ear_x-fixed_ear_w/2,0,0])
        difference() {
            union() {
                translate([0,pivot_y-6,lid_t-eps]) cube([fixed_ear_w,12,11+eps]);
                xhole(0,pivot_y,lid_t+11,18,fixed_ear_w);
            }
            xhole(-eps,pivot_y,lid_t+11,pivot_hole,fixed_ear_w+2*eps);
        }
}
module hinged_deck() {
    difference() {
        union() {
            deck_blank();
            bearing_local(-1); bearing_local(1);
        }
        // Screen has its own USB cable to computer / independent 5V supply.
        translate([screen_cx-4,32,-eps]) cube([8,15,lid_t+2*eps]);
    }
}
module carrier_up() {
    difference() {
        union() {
            screen_frame_up();
            for(s=[-1,1]) {
                // Arms overlap full 2.4mm side wall, never the 94.5mm PCB pocket.
                xx=s>0 ? 47.25 : -moving_outer_x;
                translate([xx,-5,0]) cube([moving_outer_x-47.25,21,screen_depth]);
                xhole(xx,moving_axis_y,moving_axis_z,15.5,moving_outer_x-47.25);
            }
        }
        xhole(-58,moving_axis_y,moving_axis_z,pivot_hole,116);
    }
}
module carrier_print() {
    // Screen glass face on build plate, same orientation as project's V3 front.
    translate([0,screen_side,screen_depth]) rotate([180,0,0]) carrier_up();
}
module screen_cover_up() {
    // Existing V3 cover goes into the rear (underside) of the same frame.
    translate([0,screen_half,0]) let($fn=48) rear_lid();
}
module screen_pose(a) {
    translate([screen_cx,pivot_y,pivot_z])
        rotate([a,0,0])
            translate([0,-moving_axis_y,-moving_axis_z]) children();
}

module module_retainer() {
    difference() {
        union() {
            translate([112.6,66,3.6]) cube([114.8,3,38.8]);
            for(p=retainer_screws) translate([p[0]-4,66,p[1]-4]) cube([8,3,8]);
        }
        for(x=reel_x) for(z=reel_z)
            translate([x+7,65.9,z+3]) cube([36,3.2,9]);
        for(p=retainer_screws) yhole(p[0],65.9,p[1],3.4,3.2);
    }
}
module rear_panel() {
    difference() {
        intersection() {
            roundbox([body_w,body_d,body_top-0.3],corner);
            translate([5.2,body_d-wall,3.2]) cube([body_w-10.4,wall,body_top]);
        }
        translate([ac_center[0]-ac_window[0]/2,body_d-wall-eps,ac_center[1]-ac_window[1]/2])
            cube([ac_window[0],wall+2*eps,ac_window[1]]);
        for(x=ac_screws_x) for(z=ac_screws_z) yhole(x,body_d-wall-eps,z,1.7,wall+2*eps);
        for(x=rear_screws_x) for(z=rear_screws_z) {
            yhole(x,body_d-wall-eps,z,3.4,wall+2*eps);
            translate([x,body_d-rear_head_depth,z]) rotate([-90,0,0])
                cylinder(d1=3.4,d2=rear_head_d,h=rear_head_depth+eps);
        }
        for(x=[106:5:218])
            // Keep a 3mm solid bridge below the cable notch; no merging slots.
            translate([x,body_d-wall-eps,8])
                cube([2.3,wall+2*eps,
                      x+2.3>touch_exit_x-3 && x<touch_exit_x+touch_exit_w+3
                          ? touch_exit_bottom-3-8 : 31]);
        // Cut past the upper edge so an intact cable can be laid into the notch.
        translate([touch_exit_x,body_d-wall-eps,touch_exit_bottom])
            cube([touch_exit_w,wall+2*eps,body_top-touch_exit_bottom+eps]);
    }
}
module ac_cover() {
    difference() {
        translate([8,body_d,3]) cube([76,2.4,40]);
        for(x=ac_screws_x) for(z=ac_screws_z) yhole(x,body_d-eps,z,2.4,2.4+2*eps);
        // Open U-notch admits intact extension cord without cutting it.
        yhole(ac_center[0],body_d-eps,ac_center[1],ac_wire_d,2.4+2*eps);
        translate([ac_center[0]-ac_wire_d/2,body_d-eps,2.9])
            cube([ac_wire_d,2.4+2*eps,ac_center[1]-2.9]);
    }
}
module gauge2(inner,thick=3,height=8) {
    difference() {
        roundbox([inner[0]+2*thick,inner[1]+2*thick,height],3);
        translate([thick,thick,-eps]) cube([inner[0],inner[1],height+2*eps]);
    }
}
module hinge_gauge() {
    // Two disconnected coupons deliberately laid out as two independent parts.
    difference() {
        cube([32,24,7]);
        translate([16,12,-eps]) cylinder(d=pivot_hole,h=7.1);
    }
    translate([40,0,0]) difference() {
        cube([32,24,9.25]);
        translate([16,12,-eps]) cylinder(d=pivot_hole,h=9.4);
    }
}
module reel_fit_gauge() {
    // Insert 50x15 module from the BACK; front 52x13 throat checks head clearance.
    difference() {
        roundbox([58,23,8],3);
        translate([3,3,2.4]) cube([52,17,8]);
        translate([3,5,-eps]) cube([52,13,8+2*eps]);
    }
}
module proxy_components(display_screen=true) {
    color([0.35,0.42,0.50]) translate(charger_pos) cube(charger_size);
    // Visual only: intact factory LCD fascia. Power data shown is a placeholder.
    color([0.025,0.03,0.035]) translate([12,5.35,6.2]) cube([74,0.15,31.2]);
    color([0.1,0.55,0.7]) translate([18,5.2,19]) rotate([90,0,0])
        linear_extrude(0.12) text("0 W",size=8,font="Liberation Sans");
    color([0.15,0.65,0.8]) translate([70,5.2,20]) cube([5,0.1,1.2]);
    color([0.25,0.25,0.27]) translate(socket_pos) cube(socket_size);
    for(x=reel_x) for(z=reel_z) color([0.55,0.56,0.60])
        translate([x,reel_y,z]) cube(reel_size);
    if(display_screen) if(version=="flat")
        color([0.04,0.07,0.09]) translate([screen_cx-42,screen_front+screen_half-42,body_h-0.1]) cube([84,84,0.5]);
    else screen_pose(angle)
        color([0.04,0.07,0.09]) translate([-42,screen_half-42,screen_depth-0.1]) cube([84,84,0.5]);
}
module physical_shell() {
    chassis();
    translate([0,0,body_top]) if(version=="flat") flat_deck(); else hinged_deck();
    rear_panel(); ac_cover(); module_retainer();
    if(version=="hinge") screen_pose(angle) { carrier_up(); screen_cover_up(); }
    else translate([screen_cx,screen_front,body_h-screen_depth]) screen_cover_up();
}
module assembly() {
    color([0.27,0.28,0.30]) chassis();
    color([0.34,0.35,0.38]) translate([0,0,body_top])
        if(version=="flat") flat_deck(); else hinged_deck();
    color([0.18,0.19,0.21]) { rear_panel(); ac_cover(); module_retainer(); }
    if(version=="hinge") screen_pose(angle) {
        color([0.32,0.33,0.36]) carrier_up();
        color([0.20,0.21,0.22]) screen_cover_up();
    }
    else color([0.20,0.21,0.22])
        translate([screen_cx,screen_front,body_h-screen_depth]) screen_cover_up();
    if(show_components) proxy_components();
}
module collision() {
    // Shrink references 0.01mm to exclude intentional contact at support planes.
    // Check positive-volume overlap, not contact, with nominal rigid envelopes.
    intersection() {
        physical_shell();
        union() {
            translate(charger_pos+[0.01,0.01,0.01]) cube(charger_size-[0.02,0.02,0.02]);
            translate(socket_pos+[0.01,0.01,0.01]) cube(socket_size-[0.02,0.02,0.02]);
            // Provisional right-edge USB plug envelopes; check against actual tails.
            for(y=[8,23,38,53])
                translate([charger_pos[0]+charger_size[0]+0.01,y+0.01,17.71])
                    cube([23.98,10.98,8.98]);
            for(x=reel_x) for(z=reel_z) translate([x+0.01,reel_y+0.01,z+0.01])
                cube(reel_size-[0.02,0.02,0.02]);
        }
    }
}
module movement_collision() {
    intersection() {
        screen_pose(angle) { carrier_up(); screen_cover_up(); }
        union() {
            chassis();
            translate([0,0,body_top]) hinged_deck();
            rear_panel(); ac_cover(); module_retainer();
        }
    }
}

if(part=="body") chassis();
else if(part=="lid_flat") translate([0,body_d,lid_t]) rotate([180,0,0]) flat_deck();
else if(part=="lid_hinge") hinged_deck();
else if(part=="carrier") carrier_print();
else if(part=="screen_rear") let($fn=48) rear_lid();
else if(part=="rear") translate([0,body_top-0.3,-body_d+wall]) rotate([90,0,0]) rear_panel();
else if(part=="ac_cover") translate([0,43,-body_d]) rotate([90,0,0]) ac_cover();
else if(part=="retainer") translate([0,42.4,-66]) rotate([90,0,0]) module_retainer();
else if(part=="charger_gauge") gauge2([charger_size[0]+2*charger_gap,charger_size[2]+2*charger_gap]);
else if(part=="reel_gauge") reel_fit_gauge();
else if(part=="hinge_gauge") hinge_gauge();
else if(part=="collision") collision();
else if(part=="movement_collision") movement_collision();
else if(part=="internal") {
    color([0.27,0.28,0.30]) chassis();
    color([0.18,0.19,0.21]) { rear_panel(); ac_cover(); module_retainer(); }
    proxy_components(false);
}
else if(part=="section") difference() { assembly(); translate([-1,-1,-1]) cube([body_w+2,body_d/2,250]); }
else assembly();
