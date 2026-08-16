import { sql } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';

export async function logAction(
  actor: SessionUser | null,
  action: string,
  targetType: string,
  targetId: string | number | null,
  details: unknown
) {
  try {
    await sql`
      INSERT INTO audit_log (actor_user_id, actor_name, action, target_type, target_id, details)
      VALUES (
        ${actor?.id ?? null},
        ${actor?.name ?? 'system'},
        ${action},
        ${targetType},
        ${targetId === null ? null : String(targetId)},
        ${JSON.stringify(details ?? {})}::jsonb
      )
    `;
  } catch (err) {
    // Never let audit logging break the actual operation.
    console.error('Failed to write audit log:', err);
  }
}
