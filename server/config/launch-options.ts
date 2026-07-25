// What the launch form may offer: the backends this server can actually reach right now,
// each with the models it can run (#584).
//
// Kept pure — providers and the environment come in as arguments — because the interesting
// part is the decision, not the reading: which backend is offerable, and what to tell the
// user about one that isn't. A provider that is configured but missing its token still
// appears, carrying the same sentence a session would have refused with, so the help can
// name the one thing to fix instead of describing the whole setup.
import type { LaunchOptions, LaunchProviderOption } from "../../common/launchOptions.js";
import { presetsForProvider } from "../../common/modelPresets.js";
import { usableProvider, type ProviderConfig } from "../session/provider-env.js";

export function launchOptions(providers: readonly ProviderConfig[], env: NodeJS.ProcessEnv): LaunchOptions {
  const options = providers.map((provider): LaunchProviderOption => {
    const usable = usableProvider(provider, env);
    return {
      id: provider.id,
      label: provider.label,
      ready: usable.ok,
      ...(usable.ok ? {} : { reason: usable.reason }),
      tokenEnv: provider.tokenEnv,
      models: presetsForProvider(provider.id, provider.models ?? []),
    };
  });
  return { providers: options, anyReady: options.some((option) => option.ready) };
}
