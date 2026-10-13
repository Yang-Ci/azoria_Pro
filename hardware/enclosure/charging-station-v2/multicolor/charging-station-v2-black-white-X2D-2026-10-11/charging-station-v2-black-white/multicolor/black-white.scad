// V2 black shell / flush white lettering. Units: mm.
// Original mechanical parts remain in ../workstation.scad.
use <../workstation.scad>
$fn = 36;
part = "assembly"; // black, white, coupon_black, coupon_white, assembly, front
inlay_depth = 0.8;

// Restore the original 0.6 mm engraving before cutting the bolder lettering.
// The extra 0.05 mm depth overlaps the original wall for a robust union.
module legacy_fill() {
    intersection() {
        union() {
            translate([93,0.65,24.2]) rotate([90,0,0])
                linear_extrude(0.7) text("10",size=9,font="Liberation Sans",halign="left");
            translate([93,0.65,19]) rotate([90,0,0])
                linear_extrude(0.7) text("ULTRA",size=2.4,font="Liberation Sans",halign="left");
            for(i=[0:3]) {
                xx=i%2==0 ? 107 : 168;
                zz=i<2 ? 31 : 12;
                label=i==0 ? "C1" : i==1 ? "C3" : i==2 ? "C2" : "A";
                translate([xx,0.65,zz]) rotate([90,0,0])
                    linear_extrude(0.7) text(label,size=3.2,font="Liberation Sans",halign="left");
            }
        }
        cube([236,2.8,43.6]);
    }
}
module plain_body() { union() { chassis(); legacy_fill(); } }
module face_letters() {
    // Bold plus a 0.06 mm outline; the right labels stay inside the 6 mm web.
    translate([92,24.2])
        offset(r=0.06) text("10",size=9,font="Liberation Sans:style=Bold",halign="left");
    translate([92,19])
        offset(r=0.06) text("ULTRA",size=2.8,spacing=1.08,font="Liberation Sans:style=Bold",halign="left");
    for(i=[0:3]) {
        xx=i%2==0 ? 108 : 167.15;
        // Slight optical alignment of the shorter A glyph.
        zz=i<2 ? 31 : i==3 ? 12.08 : 12;
        label=i==0 ? "C1" : i==1 ? "C3" : i==2 ? "C2" : "A";
        translate([xx,zz])
            offset(r=0.06) text(label,size=3.2,font="Liberation Sans:style=Bold",halign="left");
    }
}
module lettering(depth=inlay_depth, overcut=0) {
    translate([0,depth,0]) rotate([90,0,0]) linear_extrude(depth+overcut) face_letters();
}
module black_body() { difference() { plain_body(); lettering(overcut=0.05); } }
module white_text() { intersection() { plain_body(); lettering(); } }
module coupon_black() {
    // Extrude the planar face first, avoiding 3D font-baseline slivers.
    union() {
        translate([0,inlay_depth,0]) cube([85,2.8-inlay_depth,28]);
        translate([0,inlay_depth,0]) rotate([90,0,0]) linear_extrude(inlay_depth)
            difference() { square([85,28]); translate([-90,-9]) face_letters(); }
    }
}
module coupon_white() {
    translate([0,inlay_depth,0]) rotate([90,0,0]) linear_extrude(inlay_depth)
        translate([-90,-9]) face_letters();
}
module black_white_assembly() {
    color([0.055,0.06,0.07]) black_body();
    color([0.96,0.96,0.94]) white_text();
    color([0.065,0.07,0.08]) {
        translate([0,0,43.6]) hinged_deck();
        rear_panel(); ac_cover(); module_retainer();
        screen_pose(60) { carrier_up(); screen_cover_up(); }
    }
    proxy_components();
}
if(part=="black") black_body();
else if(part=="white") white_text();
else if(part=="coupon_black") coupon_black();
else if(part=="coupon_white") coupon_white();
else if(part=="coupon_missing") difference() { cube([85,2.8,28]); union() { coupon_black(); coupon_white(); } }
else if(part=="coupon_outside") difference() { union() { coupon_black(); coupon_white(); } cube([85,2.8,28]); }
else if(part=="overlap") intersection() { black_body(); white_text(); }
else if(part=="missing") difference() { plain_body(); union() { black_body(); white_text(); } }
else if(part=="outside") difference() { union() { black_body(); white_text(); } plain_body(); }
else if(part=="front") {
    color([0.055,0.06,0.07]) black_body();
    color([0.96,0.96,0.94]) white_text();
}
else black_white_assembly();
