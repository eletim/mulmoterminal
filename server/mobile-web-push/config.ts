// Local mobile Web Push delivery needs VAPID keys for the browser subscription and the server
// send. The private key is read only from the process environment, never from a client-visible
// config response.
export interface MobileWebPushVapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export type MobileWebPushConfig =
  | {
      enabled: true;
      vapid: MobileWebPushVapidConfig;
    }
  | {
      enabled: false;
      reason: string;
    };

const PUBLIC_KEY_ENV = "MULMOTERMINAL_MOBILE_WEB_PUSH_PUBLIC_KEY";
const PRIVATE_KEY_ENV = "MULMOTERMINAL_MOBILE_WEB_PUSH_PRIVATE_KEY";
const SUBJECT_ENV = "MULMOTERMINAL_MOBILE_WEB_PUSH_SUBJECT";

function envText(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function validSubject(value: string): boolean {
  return value.startsWith("mailto:") || value.startsWith("https://");
}

export function mobileWebPushConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MobileWebPushConfig {
  const publicKey = envText(PUBLIC_KEY_ENV, env);
  const privateKey = envText(PRIVATE_KEY_ENV, env);
  const subject = envText(SUBJECT_ENV, env);

  if (!publicKey || !privateKey || !subject) {
    return {
      enabled: false,
      reason: `Set ${PUBLIC_KEY_ENV}, ${PRIVATE_KEY_ENV}, and ${SUBJECT_ENV} to enable mobile Web Push.`,
    };
  }
  if (!validSubject(subject)) {
    return { enabled: false, reason: `${SUBJECT_ENV} must start with mailto: or https://.` };
  }

  return { enabled: true, vapid: { subject, publicKey, privateKey } };
}

export function publicMobileWebPushConfig(config: MobileWebPushConfig): { enabled: boolean; publicKey: string | null; reason?: string } {
  if (config.enabled) return { enabled: true, publicKey: config.vapid.publicKey };
  return { enabled: false, publicKey: null, reason: config.reason };
}
