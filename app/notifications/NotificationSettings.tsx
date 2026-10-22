"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AddToHomeScreen, useDeviceKind } from "@/components/InstallHelp";
import { devicePushState } from "@/lib/notificationsView";
import { ALERT_TYPES, VAPID_PUBLIC_KEY, type AlertType } from "@/lib/pushConfig";
import { removeSubscription, savePreference, saveSubscription, sendTestNotification } from "./actions";

function applicationKey() {
  const padding = "=".repeat((4 - VAPID_PUBLIC_KEY.length % 4) % 4);
  const raw = window.atob((VAPID_PUBLIC_KEY + padding).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,char => char.charCodeAt(0));
}
async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise,new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error("Device check timed out")),8000); })]); }
  finally { clearTimeout(timer); }
}
type Status = { tone:"good" | "bad"; text:string } | null;
type DeviceInfo = { permission:NotificationPermission; endpoint:string | null };
type Props = { prefs:Record<AlertType,boolean> | null; savedEndpoints:string[] | null };

export default function NotificationSettings({ prefs, savedEndpoints }: Props) {
  const router = useRouter();
  const device = useDeviceKind();
  const [known,setKnown] = useState(savedEndpoints);
  const [enabled,setEnabled] = useState(prefs);
  const [info,setInfo] = useState<DeviceInfo | null>(null);
  const [checkError,setCheckError] = useState(false);
  const [checkVersion,setCheckVersion] = useState(0);
  const [status,setStatus] = useState<Status>(null);
  const [busy,startTransition] = useTransition();
  const operation = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual refresh reloads saved server preferences
    setEnabled(prefs);
    setKnown(savedEndpoints);
  },[prefs,savedEndpoints]);
  useEffect(() => {
    if (device !== "ready") return;
    let cancelled = false;
    let ticket = 0;
    const check = async () => {
      const current = ++ticket;
      try {
        const sub = await withTimeout(navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()));
        if (!cancelled && current === ticket) { setInfo({permission:Notification.permission,endpoint:sub?.endpoint ?? null}); setCheckError(false); }
      } catch { if (!cancelled && current === ticket) setCheckError(true); }
    };
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    window.addEventListener("focus",visible);
    document.addEventListener("visibilitychange",visible);
    return () => { cancelled = true; window.removeEventListener("focus",visible); document.removeEventListener("visibilitychange",visible); };
  },[device,checkVersion,known]);

  function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setStatus(null);
    startTransition(async () => {
      try { await action(); }
      catch { setStatus({tone:"bad",text:"That change couldn’t be completed. Please try again."}); }
      finally { operation.current = false; }
    });
  }
  function turnOn() {
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setInfo(previous => ({permission,endpoint:previous?.endpoint ?? null}));
        setStatus({tone:"bad",text:permission === "denied" ? "Notifications are blocked. Allow them in your browser or device settings, then return here." : "Permission wasn’t granted. You can try again when you’re ready."});
        return;
      }
      const reg = await withTimeout(navigator.serviceWorker.ready);
      const sub = (await withTimeout(reg.pushManager.getSubscription())) ?? await withTimeout(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey()}));
      const result = await saveSubscription(sub.toJSON());
      setInfo({permission,endpoint:sub.endpoint});
      if (!result.ok) { setStatus({tone:"bad",text:result.error}); return; }
      setKnown(previous => [...new Set([...(previous ?? []),sub.endpoint])]);
      setStatus({tone:"good",text:"Notifications are on for this account on this device."});
    });
  }
  function turnOff() {
    run(async () => {
      const reg = await withTimeout(navigator.serviceWorker.ready);
      const sub = await withTimeout(reg.pushManager.getSubscription());
      const endpoint = sub?.endpoint ?? info?.endpoint;
      if (!endpoint || !known?.includes(endpoint)) { setStatus({tone:"bad",text:"This device’s saved registration changed. Reload settings before trying again."}); return; }
      const result = await removeSubscription(endpoint);
      if (!result.ok) { setStatus({tone:"bad",text:result.error}); return; }
      setKnown(previous => previous?.filter(value => value !== endpoint) ?? []);
      try {
        if (sub && !await withTimeout(sub.unsubscribe())) throw new Error("Device registration remains");
        setInfo({permission:Notification.permission,endpoint:null});
        setStatus({tone:"good",text:"Notifications are off for this account on this device."});
      } catch { setStatus({tone:"bad",text:"Alerts are off for this account. Reload this page to check the device registration."}); }
    });
  }
  function test() {
    run(async () => {
      const result = await sendTestNotification();
      setStatus(result.ok ? {tone:"good",text:result.message ?? "Test notification requested. Check your devices."} : {tone:"bad",text:result.error});
    });
  }
  function toggle(id: AlertType, value: boolean) {
    if (!enabled) return;
    const before = enabled[id];
    run(async () => {
      setEnabled(previous => previous ? {...previous,[id]:value} : previous);
      try {
        const result = await savePreference(id,value);
        if (!result.ok) { setEnabled(previous => previous ? {...previous,[id]:before} : previous); setStatus({tone:"bad",text:result.error}); }
        else setStatus({tone:"good",text:"Alert preferences saved."});
      } catch { setEnabled(previous => previous ? {...previous,[id]:before} : previous); throw new Error("Preference not saved"); }
    });
  }

  const state = info ? devicePushState(info.permission,info.endpoint,known) : null;
  const savedHere = Boolean(info?.endpoint && known?.includes(info.endpoint));
  return <div className="space-y-5" aria-busy={busy}>
    <section className="surface p-4 sm:p-5">
      <h2 className="section-title">This device</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">
        {device === null && <p role="status" className="text-muted">Checking this device…</p>}
        {device === "ios-browser" && <AddToHomeScreen />}
        {device === "unsupported" && <p className="text-muted">This browser can’t receive notifications. Try a supported browser, or open the installed Raptor app.</p>}
        {device === "ready" && <>
          {known === null ? <p className="text-warning">Your saved devices couldn’t load. Reload settings before changing notifications.</p> : checkError ? <><p className="text-warning">This device couldn’t be checked. Try again, or reload this page.</p><button type="button" className="button-secondary" onClick={() => setCheckVersion(value => value+1)}>Check device again</button></> : info === null ? <p role="status" className="text-muted">Checking this device…</p> : <>
            <p className={state === "blocked" ? "text-warning" : "text-muted"}>{state === "on" ? "Notifications are on for this account on this device." : state === "blocked" ? "Notifications are blocked in browser or device settings." : "Notifications are off for this account on this device."}</p>
            {!savedHere && info.endpoint && <p className="text-xs text-muted">A browser registration exists, but it isn’t saved for this account. Turn on notifications to connect it.</p>}
            <div className="flex flex-wrap gap-2">
              {state === "on" && <button type="button" className="button-primary" disabled={busy} onClick={test}>Send a test notification</button>}
              {savedHere ? <button type="button" className="button-secondary" disabled={busy} onClick={turnOff}>Turn off on this device</button> : <button type="button" className="button-primary" disabled={busy || state === "blocked"} onClick={turnOn}>{busy ? "One moment…" : "Turn on notifications"}</button>}
            </div>
          </>}
        </>}
        {status && <p role={status.tone === "bad" ? "alert" : "status"} className={"rounded-lg px-3 py-3 text-sm "+(status.tone === "good" ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning")}>{status.text}</p>}
      </div>
    </section>
    <section className="surface p-4 sm:p-5">
      <h2 className="section-title">Alerts to receive</h2><p className="mt-1 text-sm text-muted">These choices apply to every device connected to your account.</p>
      {enabled === null ? <p role="status" className="mt-4 text-sm text-warning">Alert preferences couldn’t load. Reload settings to try again.</p> : <ul className="mt-3 divide-y divide-line">
        {ALERT_TYPES.map(alert => <li key={alert.id}><label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-3 text-sm"><span>{alert.label}</span><input type="checkbox" checked={enabled[alert.id]} disabled={busy} onChange={event => toggle(alert.id,event.target.checked)} className="h-5 w-5 shrink-0 accent-accent disabled:opacity-50" /></label></li>)}
      </ul>}
    </section>
    <button type="button" className="text-link min-h-11 text-sm" disabled={busy} onClick={() => startTransition(() => router.refresh())}>Reload settings</button>
  </div>;
}
