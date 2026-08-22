import { z } from "zod";
import { readEmployeeSession } from "../../core/employee-session";
import { getSupabaseClient } from "../../data/supabase";

export type Row = Record<string, unknown>;

const rowSchema = z.record(z.string(), z.unknown());

export const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export const date = (value: unknown): string =>
  value ? new Date(String(value)).toLocaleDateString("fr-FR") : "—";

export const dateTime = (value: unknown): string =>
  value
    ? new Date(String(value)).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris"
    })
    : "—";

export function dateTimeLocalValue(value: unknown = new Date()): string {
  const parsed = new Date(String(value));
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

export async function rows(source: string, select = "*"): Promise<Row[]> {
  const { data, error } = await getSupabaseClient().from(source).select(select);
  if (error) throw new Error(error.message);
  return z.array(rowSchema).parse(data);
}

export async function mutate(
  request: PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  const { error } = await request;
  if (error) throw new Error(error.message);
}

export function activeEmployeeId(): string | number {
  const session = readEmployeeSession();
  if (!session) throw new Error("Sélectionnez un employé.");
  return session.employeeId;
}
