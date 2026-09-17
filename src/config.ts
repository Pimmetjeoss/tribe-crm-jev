export interface AppConfig {
  tribe?: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    writesEnabled: boolean;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const clientId = env.TRIBE_CLIENT_ID?.trim();
  const clientSecret = env.TRIBE_CLIENT_SECRET?.trim();

  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new Error("TRIBE_CLIENT_ID and TRIBE_CLIENT_SECRET must be configured together.");
  }

  if (!clientId || !clientSecret) return {};

  return {
    tribe: {
      clientId,
      clientSecret,
      baseUrl: (env.TRIBE_BASE_URL ?? "https://api.tribecrm.nl").replace(/\/$/, ""),
      writesEnabled: env.TRIBE_ENABLE_WRITES?.toLowerCase() === "true",
    },
  };
}
