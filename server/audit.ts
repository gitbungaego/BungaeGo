// Minimal audit trail for destructive/admin actions. There is no audit table
// yet, so this logs a structured line to the server console — enough to trace
// "who did what when" from logs.
//
// TODO(audit): persist to an `audit_logs` table (adminId, action, targetType,
// targetId, detail, createdAt) once admin activity needs to be queried in-app.
export function auditLog(
  adminId: number,
  action: string,
  target: { type: string; id: number },
  detail?: Record<string, unknown>
): void {
  console.log(
    `[audit] admin#${adminId} ${action} ${target.type}#${target.id} at ${new Date().toISOString()}` +
      (detail ? ` :: ${JSON.stringify(detail)}` : "")
  );
}
