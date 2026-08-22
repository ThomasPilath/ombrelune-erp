import { z } from "zod";

const optionalUrl = z.preprocess(
  value => value === "" ? undefined : value,
  z.string().url().optional()
);

const optionalUuid = z.preprocess(
  value => value === "" ? undefined : value,
  z.string().uuid().optional()
);

const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  VITE_UMAMI_SCRIPT_URL: optionalUrl,
  VITE_UMAMI_WEBSITE_ID: optionalUuid
}).refine(
  env => Boolean(env.VITE_UMAMI_SCRIPT_URL) === Boolean(env.VITE_UMAMI_WEBSITE_ID),
  { message: "VITE_UMAMI_SCRIPT_URL et VITE_UMAMI_WEBSITE_ID doivent être renseignées ensemble" }
);

declare global {
  interface Window {
    __OMBRELUNE_CONFIG__?: Partial<PublicEnv>;
  }
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(value: unknown): PublicEnv {
  return publicEnvSchema.parse(value);
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    ...import.meta.env,
    ...window.__OMBRELUNE_CONFIG__
  });
}
