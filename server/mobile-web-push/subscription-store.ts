import { existsSync } from "node:fs";
import path from "node:path";
import { readJsonFile } from "../infra/read-text-file.js";
import { writeFileAtomic } from "../files/atomic-write.js";
import { MULMOTERMINAL_HOME } from "../config/env.js";
import { isRecord } from "../../common/isRecord.js";

export interface MobileWebPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MobileWebPushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface SubscriptionFile {
  subscriptions: MobileWebPushSubscription[];
}

export interface MobileWebPushSubscriptionStore {
  list(): Promise<MobileWebPushSubscription[]>;
  upsert(subscription: MobileWebPushSubscriptionInput): Promise<{ created: boolean; count: number }>;
  removeEndpoint(endpoint: string): Promise<{ removed: boolean; count: number }>;
  removeEndpoints(endpoints: readonly string[]): Promise<{ removed: number; count: number }>;
}

const ENDPOINT_MAX_CHARS = 2048;
const KEY_MAX_CHARS = 512;

export const mobileWebPushSubscriptionsFile = (root = MULMOTERMINAL_HOME): string => path.join(root, "mobile-web-push-subscriptions.json");

function nonEmptyLimited(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= max;
}

function safeEndpoint(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function parseMobileWebPushSubscription(value: unknown): MobileWebPushSubscriptionInput | null {
  if (!isRecord(value)) return null;
  const { endpoint, expirationTime, keys } = value;
  if (!nonEmptyLimited(endpoint, ENDPOINT_MAX_CHARS) || !safeEndpoint(endpoint)) return null;
  if (expirationTime !== undefined && expirationTime !== null && typeof expirationTime !== "number") return null;
  if (typeof expirationTime === "number" && (!Number.isFinite(expirationTime) || expirationTime < 0)) return null;
  if (!isRecord(keys) || !nonEmptyLimited(keys.p256dh, KEY_MAX_CHARS) || !nonEmptyLimited(keys.auth, KEY_MAX_CHARS)) return null;
  return { endpoint, expirationTime: expirationTime ?? null, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function parseStoredSubscription(value: unknown): MobileWebPushSubscription | null {
  if (!isRecord(value)) return null;
  const parsed = parseMobileWebPushSubscription(value);
  if (!parsed || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  return { ...parsed, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

function readFile(file: string): SubscriptionFile {
  if (!existsSync(file)) return { subscriptions: [] };
  try {
    const raw = readJsonFile(file);
    if (!isRecord(raw) || !Array.isArray(raw.subscriptions)) return { subscriptions: [] };
    const byEndpoint = new Map<string, MobileWebPushSubscription>();
    for (const entry of raw.subscriptions) {
      const parsed = parseStoredSubscription(entry);
      if (parsed) byEndpoint.set(parsed.endpoint, parsed);
    }
    return { subscriptions: [...byEndpoint.values()] };
  } catch {
    return { subscriptions: [] };
  }
}

async function writeFile(file: string, subscriptions: readonly MobileWebPushSubscription[]): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify({ subscriptions }, null, 2)}\n`);
}

export function createMobileWebPushSubscriptionStore(
  file = mobileWebPushSubscriptionsFile(),
  now: () => Date = () => new Date(),
): MobileWebPushSubscriptionStore {
  let chain = Promise.resolve();

  const update = async <T>(
    fn: (
      current: MobileWebPushSubscription[],
    ) => Promise<{ subscriptions: MobileWebPushSubscription[]; result: T }> | { subscriptions: MobileWebPushSubscription[]; result: T },
  ): Promise<T> => {
    const run = chain.then(async () => {
      const current = readFile(file).subscriptions;
      const { subscriptions, result } = await fn(current);
      await writeFile(file, subscriptions);
      return result;
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    async list() {
      await chain;
      return readFile(file).subscriptions;
    },
    upsert(subscription) {
      return update((current) => {
        const stamp = now().toISOString();
        const existing = current.find((entry) => entry.endpoint === subscription.endpoint);
        const next = existing ? { ...subscription, createdAt: existing.createdAt, updatedAt: stamp } : { ...subscription, createdAt: stamp, updatedAt: stamp };
        const subscriptions = [...current.filter((entry) => entry.endpoint !== subscription.endpoint), next];
        return { subscriptions, result: { created: !existing, count: subscriptions.length } };
      });
    },
    removeEndpoint(endpoint) {
      return update((current) => {
        const subscriptions = current.filter((entry) => entry.endpoint !== endpoint);
        return { subscriptions, result: { removed: subscriptions.length !== current.length, count: subscriptions.length } };
      });
    },
    removeEndpoints(endpoints) {
      const doomed = new Set(endpoints);
      return update((current) => {
        const subscriptions = current.filter((entry) => !doomed.has(entry.endpoint));
        return { subscriptions, result: { removed: current.length - subscriptions.length, count: subscriptions.length } };
      });
    },
  };
}
