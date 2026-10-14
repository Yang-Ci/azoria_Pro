#include "features/display_control/power_view.h"
#include "features/display_control/screen.h"

namespace DisplayControl::PowerView {
namespace {
lv_obj_t *view, *status, *battery, *battery_state, *mode, *screens, *off_button, *on_button, *link_button, *link_text, *timer_text;
lv_obj_t *text(lv_obj_t *parent, const char *content, int x, int y, const lv_font_t *font, uint32_t ink) {
  lv_obj_t *object = lv_label_create(parent); lv_label_set_text(object, content); lv_obj_set_pos(object, x, y);
  lv_obj_set_style_text_font(object, font, 0); lv_obj_set_style_text_color(object, lv_color_hex(ink), 0); return object;
}
void back(lv_event_t *) { hide(); }
void command(lv_event_t *event) {
  const char *action = static_cast<const char *>(lv_event_get_user_data(event));
  noteInteraction(); queuePowerControl(action);
}
void toggleLink(lv_event_t *) {
  const RemoteState state = getRemoteState(); noteInteraction();
  queuePowerControl(state.external_power_linked ? "link-off" : "link-on");
}
lv_obj_t *button(lv_obj_t *parent, int x, int y, int width, int height, uint32_t ink) {
  lv_obj_t *object = lv_btn_create(parent); lv_obj_set_pos(object,x,y); lv_obj_set_size(object,width,height);
  lv_obj_set_style_bg_color(object,lv_color_hex(ink),0); lv_obj_set_style_radius(object,12,0);
  lv_obj_set_style_border_width(object,0,0);lv_obj_set_style_shadow_width(object,0,0);
  lv_obj_set_style_pad_all(object,0,0);lv_obj_clear_flag(object,LV_OBJ_FLAG_SCROLLABLE);return object;
}
void disabled(lv_obj_t *button, bool value) { if(value)lv_obj_add_state(button,LV_STATE_DISABLED);else lv_obj_clear_state(button,LV_STATE_DISABLED); }
}
void create(lv_obj_t *parent) {
  view=lv_obj_create(parent);lv_obj_remove_style_all(view);lv_obj_set_size(view,480,480);
  lv_obj_set_style_bg_color(view,lv_color_hex(0x0B0C10),0);lv_obj_set_style_bg_opa(view,LV_OPA_COVER,0);
  lv_obj_clear_flag(view,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_GESTURE_BUBBLE);
  text(view,"POWER",20,18,&lv_font_montserrat_28,0xF6F1E9);
  status=text(view,"WAITING FOR DESKTOP",21,55,&lv_font_montserrat_16,0x929292);
  lv_obj_t *back_button=button(view,418,15,44,44,0x15171D);lv_obj_add_event_cb(back_button,back,LV_EVENT_CLICKED,nullptr);
  lv_obj_center(text(back_button,LV_SYMBOL_LEFT,0,0,&lv_font_montserrat_18,0xF6F1E9));
  text(view,"LAPTOP BATTERY",20,96,&lv_font_montserrat_16,0x929292);
  battery=text(view,"--",20,123,&lv_font_montserrat_28,0xF6F1E9);
  battery_state=text(view,"unknown",112,133,&lv_font_montserrat_16,0x929292);lv_obj_set_width(battery_state,100);lv_label_set_long_mode(battery_state,LV_LABEL_LONG_DOT);
  mode=text(view,"POWER MODE: --",220,104,&lv_font_montserrat_16,0xFFC166);lv_obj_set_width(mode,240);lv_label_set_long_mode(mode,LV_LABEL_LONG_WRAP);
  screens=text(view,"EXTERNAL SCREENS: --",20,177,&lv_font_montserrat_18,0x20DFE5);
  off_button=button(view,20,216,214,74,0x29231B);
  lv_obj_center(text(off_button,"SCREENS OFF",0,0,&lv_font_montserrat_18,0xFFC166));
  lv_obj_add_event_cb(off_button,command,LV_EVENT_CLICKED,const_cast<char *>("off"));
  on_button=button(view,246,216,214,74,0x142A2C);
  lv_obj_center(text(on_button,"RESTORE",0,0,&lv_font_montserrat_18,0x20DFE5));
  lv_obj_add_event_cb(on_button,command,LV_EVENT_CLICKED,const_cast<char *>("on"));
  text(view,"Laptop screen stays on",20,302,&lv_font_montserrat_16,0x929292);
  link_button=button(view,20,344,440,54,0x15171D);
  link_text=text(link_button,"LINK TOUCH SLEEP: OFF",16,17,&lv_font_montserrat_16,0xF6F1E9);
  lv_obj_add_event_cb(link_button,toggleLink,LV_EVENT_CLICKED,nullptr);
  timer_text=text(view,"Touch timer is disabled",20,417,&lv_font_montserrat_16,0x929292);
  text(view,"Set sleep times in Desktop",20,446,&lv_font_montserrat_16,0x929292);
  lv_obj_add_flag(view,LV_OBJ_FLAG_HIDDEN);
}
void show(){if(!view)return;noteInteraction();lv_obj_clear_flag(view,LV_OBJ_FLAG_HIDDEN);lv_obj_move_foreground(view);}
void hide(){if(view)lv_obj_add_flag(view,LV_OBJ_FLAG_HIDDEN);noteInteraction();}
bool active(){return view&&!lv_obj_has_flag(view,LV_OBJ_FLAG_HIDDEN);}
void refresh(const RemoteState &state){
  if(!active())return;
  lv_label_set_text(status,state.power_pending||state.power_busy?"APPLYING...":state.power_supported?"LIVE DESKTOP DATA":"WAITING FOR DESKTOP UPDATE");
  char buffer[80];
  snprintf(buffer,sizeof(buffer),"%d%%",state.battery_percent);
  lv_label_set_text(battery,state.battery_percent>=0?buffer:"--");
  lv_label_set_text(battery_state,state.battery_status);
  snprintf(buffer,sizeof(buffer),"MODE: %s",state.power_mode);lv_label_set_text(mode,buffer);
  snprintf(buffer,sizeof(buffer),"%u EXTERNAL SCREENS: %s",state.external_screen_count,state.external_screens_off?"OFF":"ON");lv_label_set_text(screens,buffer);
  const bool blocked=!state.online||!state.power_supported||state.power_pending||state.power_busy;
  disabled(off_button,blocked||state.external_screens_off||state.external_screen_count==0);
  disabled(on_button,blocked||!state.external_screens_off);disabled(link_button,blocked);
  lv_label_set_text(link_text,state.external_power_linked?"LINK TOUCH SLEEP: ON":"LINK TOUCH SLEEP: OFF");
  lv_obj_set_style_bg_color(link_button,lv_color_hex(state.external_power_linked?0x142A2C:0x15171D),0);
  snprintf(buffer,sizeof(buffer),"TOUCH TIMER: %02u:%02u - %02u:%02u",state.touch_sleep_start_minutes/60,state.touch_sleep_start_minutes%60,state.touch_sleep_end_minutes/60,state.touch_sleep_end_minutes%60);
  lv_label_set_text(timer_text,state.touch_sleep_enabled?buffer:"Touch timer is disabled");
}
}
