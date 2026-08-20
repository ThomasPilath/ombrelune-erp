import { employeeRowSchema, type EmployeeRow } from "../schemas";
import { selectRows } from "../supabase";

let employeeRequest: Promise<EmployeeRow[]> | undefined;

export function getEmployees(): Promise<EmployeeRow[]> {
  employeeRequest ??= selectRows("employes", employeeRowSchema).then(rows =>
    rows.sort((left, right) => left.nom_prenom.localeCompare(right.nom_prenom, "fr"))
  );
  return employeeRequest;
}

export function refreshEmployees(): Promise<EmployeeRow[]> {
  employeeRequest = undefined;
  return getEmployees();
}
