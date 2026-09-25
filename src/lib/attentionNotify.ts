/**
 * Desktop notifications for the F3 inbox. Pure planner: the shell supplies
 * time, quiet hours and a sink. Dismissed tags skip a repeat toast; they never
 * shrink the inbox.
 */

import { redactPayload, type InboxEntry } from "./attentionInbox";

export interface QuietHours {
  /** Local hour 0–23, inclusive start. */
  startHour: number;
  /** Local hour 0–23, exclusive end. 8 means quiet until 08:00. */
  endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 22, endHour: 8 };

export interface NotifyPlan {
  notifications: Array<{ tag: string; title: string; body: string }>;
  /** Taskbar/title badge: blocking entries, then everything else. */
  badge: number;
  quiet: boolean;
}

export function inQuietHours(now: Date, hours: QuietHours): boolean {
  const hour = now.getHours();
  if (hours.startHour === hours.endHour) return false;
  if (hours.startHour < hours.endHour) {
    return hour >= hours.startHour && hour < hours.endHour;
  }
  return hour >= hours.startHour || hour < hours.endHour;
}

export function planNotifications(
  previous: readonly InboxEntry[],
  next: readonly InboxEntry[],
  opts: {
    now: Date;
    quiet?: QuietHours;
    dismissedKeys?: ReadonlySet<string>;
  },
): NotifyPlan {
  const quietHours = opts.quiet ?? DEFAULT_QUIET_HOURS;
  const dismissed = opts.dismissedKeys ?? new Set<string>();
  const quiet = inQuietHours(opts.now, quietHours);
  const prevByKey = new Map(previous.map((entry) => [entry.key, entry]));
  const notifications: NotifyPlan["notifications"] = [];

  for (const entry of next) {
    if (dismissed.has(entry.key)) continue;
    const prior = prevByKey.get(entry.key);
    const grew = prior === undefined || entry.count > prior.count;
    if (!grew) continue;
    notifications.push({
      tag: entry.key,
      title: entry.grade === "blocking" ? "ProjectA — Blockade" : "ProjectA — Attention",
      body: redactPayload(entry.title),
    });
  }

  const badge = next.length;
  return {
    notifications: quiet ? [] : notifications,
    badge,
    quiet,
  };
}

export interface NotifySink {
  notify: (n: { tag: string; title: string; body: string }) => void;
  badge: (count: number) => void;
}

/**
 * Apply a plan. OS Notification is optional; missing permission is not an
 * error. Packaged taskbar flash is F8 — this only updates the document title
 * via the badge sink the shell provides.
 */
export function applyNotifyPlan(plan: NotifyPlan, sink: NotifySink): void {
  sink.badge(plan.badge);
  for (const note of plan.notifications) {
    sink.notify(note);
  }
}

/** Default webview sink. Safe to call where `Notification` does not exist. */
export function webviewNotifySink(): NotifySink {
  const original = typeof document === "undefined" ? "ProjectA" : document.title.replace(/^\(\d+\)\s*/, "");
  return {
    notify: (note) => {
      const NotificationImpl = (globalThis as { Notification?: typeof Notification }).Notification;
      if (typeof NotificationImpl !== "function") return;
      if (NotificationImpl.permission !== "granted") return;
      try {
        new NotificationImpl(note.title, { body: note.body, tag: note.tag });
      } catch {
        /* webview without the constructor — badge still moves */
      }
    },
    badge: (count) => {
      if (typeof document === "undefined") return;
      document.title = count > 0 ? `(${count}) ${original}` : original;
    },
  };
}
