import { describe, expect, it } from "vitest";
import { devicePushState, notificationPreferences, pushDeviceKind } from "@/lib/notificationsView";
import { ALERT_TYPES } from "@/lib/pushConfig";

describe("Notification preferences", () => {
  it("defaults only known alert types to enabled and preserves saved choices", () => {
    const prefs = notificationPreferences([{alert_type:"deadline_1h",enabled:false},{alert_type:"unknown",enabled:false}]);
    expect(Object.keys(prefs)).toEqual(ALERT_TYPES.map(alert => alert.id));
    expect(prefs.deadline_1h).toBe(false);
    expect(prefs.player_flag).toBe(true);
  });
});
describe("Device notification status", () => {
  it("requires permission, a browser subscription and a registration saved to this account", () => {
    expect(devicePushState("granted","mine",["mine"])).toBe("on");
    expect(devicePushState("granted","other",["mine"])).toBe("off");
    expect(devicePushState("granted",null,["mine"])).toBe("off");
    expect(devicePushState("default","mine",["mine"])).toBe("off");
  });
  it("does not report success when permissions or saved devices are unavailable", () => {
    expect(devicePushState("denied","mine",["mine"])).toBe("blocked");
    expect(devicePushState("granted","mine",null)).toBe("unknown");
  });
});
describe("Install and push capability", () => {
  const device = {userAgent:"iPhone",touchPoints:5,standalone:false,supported:true};
  it("shows installation help on an iPhone browser and supports installed apps", () => {
    expect(pushDeviceKind(device)).toBe("ios-browser");
    expect(pushDeviceKind({...device,standalone:true})).toBe("ready");
  });
  it("recognises an iPad using a desktop user agent", () => expect(pushDeviceKind({...device,userAgent:"Macintosh"})).toBe("ios-browser"));
  it("checks push support even after installation", () => {
    expect(pushDeviceKind({...device,standalone:true,supported:false})).toBe("unsupported");
    expect(pushDeviceKind({...device,userAgent:"Android",touchPoints:1})).toBe("ready");
    expect(pushDeviceKind({...device,userAgent:"Desktop",touchPoints:0,supported:false})).toBe("unsupported");
  });
});
