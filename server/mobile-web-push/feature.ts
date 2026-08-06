import { getPushEnabled, getPushKinds } from "../config/config-routes.js";
import { messageOf } from "../errors.js";
import type { SessionLifecycleDeps } from "../session/lifecycle.js";
import { pushClassification, translationWorkerIds } from "../session/registry.js";
import { shouldSuppressPush, wantsPushKind } from "../session/taskPushRules.js";
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

export function mobileWebPushActivityLifecycleDeps({
  mode,
  sender,
}: {
  mode: string;
  sender: MobileWebPushSender;
}): Pick<SessionLifecycleDeps, "notifyMobileWebPushActivity"> | Record<string, never> {
  if (mode !== "local") return {};
  return {
    notifyMobileWebPushActivity: (notification) => {
      if (!wantsPushKind(getPushEnabled(), getPushKinds(), notification.kind)) return;
      void (async () => {
        const { background, userScheduled } = await pushClassification(notification.sessionId);
        if (shouldSuppressPush(background, translationWorkerIds.has(notification.sessionId), userScheduled)) return;
        await sender.sendActivity(notification.kind, notification);
      })().catch((err) => {
        console.warn(`[mobile-web-push] activity notification failed for ${notification.sessionId}: ${messageOf(err)}`);
      });
    },
  };
}
