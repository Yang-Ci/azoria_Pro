use <../workstation.scad>
color([0.085,0.09,0.10]) import("base-black.stl");
// Visual-only offset for flush-material OpenCSG preview.
color([0.96,0.96,0.94]) translate([0,-0.03,0]) import("base-white-text.stl");
color([0.085,0.09,0.10]) {
 translate([0,0,43.6]) hinged_deck();
 rear_panel(); ac_cover(); module_retainer();
 screen_pose(60) { carrier_up(); screen_cover_up(); }
}
proxy_components();
