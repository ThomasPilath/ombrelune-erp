import { z } from "zod";

const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20)
});

declare global {
  interface Window {
    __OMBRELUNE_CONFIG__?: Partial<PublicEnv>;
  }
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    ...import.meta.env,
    ...window.__OMBRELUNE_CONFIG__
  });
}
