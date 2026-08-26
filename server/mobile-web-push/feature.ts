import { getPushKinds } from "../config/config-routes.js";
import { messageOf } from "../errors.js";
import type { ActivityServiceDeps } from "../session/session-activity.js";
import { isUserScheduledSession, userScheduledSessionsHydrated } from "../session/registry.js";
import { coreSessions } from "../session/core-session-adapter.js";
import { shouldSuppressPush } from "../session/taskPushRules.js";
import { mobileWebPushConfigFromEnv } from "./config.js";
import { createMobileWebPushSender, type MobileWebPushSender } from "./sender.js";
import { createMobileWebPushSubscriptionStore, mobileWebPushSubscriptionsFile } from "./subscription-store.js";

export function createMobileWebPushFeature(home: string) {
  const subscriptions = createMobileWebPushSubscriptionStore(mobileWebPushSubscriptionsFile(home));
  return {
    config: mobileWebPushConfigFromEnv,
    subscriptions,
    sender: createMobileWebPushSender({ config: mobileWebPushConfigFromEnv, store: subscriptions }),
  };
}

export function mobileWebPushActivityDeps({
  sender,
}: {
  sender: MobileWebPushSender;
}): Pick<ActivityServiceDeps, "notifyMobileWebPushActivity"> | Record<string, never> {
  return {
    notifyMobileWebPushActivity: (notification) => {
      if (!getPushKinds().includes(notification.kind)) return;
      void (async () => {
        const [session] = await Promise.all([coreSessions.find(notification.sessionId), userScheduledSessionsHydrated]);
        const visibility = session?.visibility ?? "normal";
        if (shouldSuppressPush(visibility === "background", visibility === "internal", isUserScheduledSession(notification.sessionId))) return;
        await sender.sendActivity(notification.kind, notification);
      })().catch((err) => {
        console.warn(`[mobile-web-push] activity notification failed for ${notification.sessionId}: ${messageOf(err)}`);
      });
    },
  };
}
