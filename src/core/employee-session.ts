import { z } from "zod";
import type { EmployeeRow } from "../data/schemas";

const storageKey = "ombrelune-active-employee";
const sessionDuration = 12 * 60 * 60 * 1_000;

const employeeSessionSchema = z.object({
  employeeId: z.union([z.string(), z.number()]),
  employeeName: z.string().min(1),
  employeeGrade: z.enum(["Patron", "Co-Patron", "Adulte", "Étudiant"]),
  directionAuthorized: z.boolean(),
  selectedAt: z.number().int().positive()
});

export type EmployeeSession = z.infer<typeof employeeSessionSchema>;

export function readEmployeeSession(): EmployeeSession | null {
  const storedValue = localStorage.getItem(storageKey);
  if (!storedValue) return null;

  try {
    const session = employeeSessionSchema.parse(JSON.parse(storedValue));
    if (Date.now() - session.selectedAt >= sessionDuration) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function isDirectionEmployee(employee: EmployeeRow): boolean {
  return employee.grade === "Patron" || employee.grade === "Co-Patron";
}

export function hasDirectionAccess(session = readEmployeeSession()): boolean {
  return Boolean(session?.directionAuthorized && (session.employeeGrade === "Patron" || session.employeeGrade === "Co-Patron"));
}

export function saveEmployeeSession(employee: EmployeeRow, directionAuthorized = false): EmployeeSession {
  const session: EmployeeSession = {
    employeeId: employee.id,
    employeeName: employee.nom_prenom,
    employeeGrade: employee.grade,
    directionAuthorized: isDirectionEmployee(employee) && directionAuthorized,
    selectedAt: Date.now()
  };
  localStorage.setItem(storageKey, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent<EmployeeSession>("ombrelune:employee-change", { detail: session }));
  return session;
}

export function clearEmployeeSession(): void {
  localStorage.removeItem(storageKey);
}
