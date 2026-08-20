import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getPublicEnv } from "../config/env";

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const env = getPublicEnv();
  client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

export async function selectRows<TSchema extends z.ZodType>(
  table: string,
  rowSchema: TSchema,
  select = "*"
): Promise<Array<z.output<TSchema>>> {
  const { data, error } = await getSupabaseClient().from(table).select(select);

  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

export async function callRpc<TSchema extends z.ZodType>(
  name: string,
  parameters: Record<string, unknown>,
  resultSchema: TSchema
): Promise<z.output<TSchema>> {
  const { data, error } = await getSupabaseClient().rpc(name, parameters);
  if (error) throw new Error(error.message);
  return resultSchema.parse(data);
}
