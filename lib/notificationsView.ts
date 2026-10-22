import { ALERT_TYPES, type AlertType } from "@/lib/pushConfig";

export function notificationPreferences(rows: { alert_type: string; enabled: boolean }[]): Record<AlertType,boolean> {
  const prefs = Object.fromEntries(ALERT_TYPES.map(alert => [alert.id,true])) as Record<AlertType,boolean>;
  for (const row of rows) if (ALERT_TYPES.some(alert => alert.id === row.alert_type)) prefs[row.alert_type as AlertType] = row.enabled;
  return prefs;
}

export function devicePushState(permission: NotificationPermission, endpoint: string | null, savedEndpoints: readonly string[] | null): "on" | "off" | "blocked" | "unknown" {
  if (savedEndpoints === null) return "unknown";
  if (permission === "denied") return "blocked";
  return permission === "granted" && endpoint && savedEndpoints.includes(endpoint) ? "on" : "off";
}

export type DeviceKind = "ios-browser" | "ready" | "unsupported";
export function pushDeviceKind({ userAgent, touchPoints, standalone, supported }: { userAgent: string; touchPoints: number; standalone: boolean; supported: boolean }): DeviceKind {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || userAgent.includes("Mac") && touchPoints > 1;
  if (ios && !standalone) return "ios-browser";
  return supported ? "ready" : "unsupported";
}
