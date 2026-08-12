// Shared helper: records a push/email broadcast send as an activity_logs row so
// history is server-side and consistent across every device/browser, instead of
// the old per-browser localStorage cache.

export const PUSH_HISTORY_ACTION = 'PUSH_NOTIFICATION_SENT';
export const EMAIL_HISTORY_ACTION = 'EMAIL_BROADCAST_SENT';
export const NOTIFICATION_HISTORY_ACTIONS = [PUSH_HISTORY_ACTION, EMAIL_HISTORY_ACTION];

/**
 * Best-effort: a logging failure must never break the actual send response.
 * Returns the new activity_logs row id, or null if logging failed.
 */
export async function logNotificationHistory(adminClient, {
  action = PUSH_HISTORY_ACTION,
  userId,
  actorEmail,
  request,
  response,
  success,
  statusCode,
  meta,
}) {
  try {
    const { data, error } = await adminClient
      .from('activity_logs')
      .insert({
        user_id: userId || null,
        actor_email: actorEmail || null,
        action,
        resource_type: 'notification_broadcast',
        resource_id: null,
        details: {
          request,
          response,
          success: !!success,
          statusCode: statusCode ?? null,
          sent: meta?.sent ?? null,
          failed: meta?.failed ?? null,
          matchedTokensCount: meta?.matchedTokensCount ?? null,
        },
        source: 'jlo',
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[notificationHistory] insert failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn('[notificationHistory] insert threw:', err instanceof Error ? err.message : err);
    return null;
  }
}
