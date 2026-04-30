# 02 — OneSignal down / pushes not delivering

## Symptoms

- Customers report they're not getting notified when their AI Employee
  escalates / customer replies
- `/api/mobile/push/enroll` returning 5xx
- OneSignal dashboard shows delivery rate <90%
- `notifications` table has rows but `onesignal_notification_id` is NULL

## Quick diagnose

1. **Is OneSignal up?** `https://status.onesignal.com`. Their API has had
   ~2 multi-hour outages per year historically.
2. **Is it dispatch failing or aliasing failing?** Vercel logs:
   - `[push] dispatch failed` → REST `POST /notifications` returning 5xx
   - `[push] aliasing failed (non-fatal)` → enrollment is OK but external_id
     won't fan out to all of the user's devices on this enrollment
3. **Is iOS only or both?** Check the `platform` column on recent `push_subscriptions`.
   APNS issues vs FCM issues need different escalation paths.

## Mitigation

### A. OneSignal-side outage

1. The system is already resilient — failed dispatches don't fail the
   user-facing operation. The `notifications` row is still inserted so
   in-app history stays accurate; only the push fanout is missed.
2. After OneSignal recovers, run the backfill cron:
   ```bash
   curl -X POST "$DASHBOARD_URL/api/admin/replay-failed-pushes" \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -d '{"since":"2026-04-28T10:00:00Z"}'
   ```
   Selects rows where `onesignal_notification_id IS NULL AND created_at > since`
   and re-dispatches up to 24h backlog.

### B. Aliasing intermittently failing but dispatch OK

Run the alias backfill — picks up subscriptions whose external_id never
landed:

```sql
select onesignal_subscription_id, user_id
from public.push_subscriptions
where last_seen_at > now() - interval '7 days';
```

For each row call `aliasSubscription()` from `lib/push/onesignal.ts`. We
have a `/api/admin/realias-subscriptions` endpoint that does this in bulk.

### C. Test account/keys are wrong

Symptom: 401 from OneSignal API. Check Vercel env:
- `ONESIGNAL_APP_ID` — UUID, find in OneSignal dashboard → Settings → Keys & IDs
- `ONESIGNAL_REST_API_KEY` — starts with `os_v2_`, same screen

Rotation procedure: change in OneSignal dashboard → update Vercel env →
redeploy. Old key works for ~1h grace period during overlap.

## Recovery

1. OneSignal back up → run replay-failed-pushes cron with `since=outage_start`
2. Verify in OneSignal dashboard: delivery rate back >97%
3. Spot-check 3 recent customer escalations — confirm push received

## Postmortem

If users missed customer-reply pushes during outage:
- Apologise via in-app banner (top of inbox), one-time
- Add the missing notifications to /notifications inbox if they aren't already
  (the `notifications` row exists either way — push is the only thing missed)
- Decide whether iOS Time-Sensitive Notifications changes severity weighting

## Known gotchas

- iOS focus filters can suppress non-time-sensitive pushes silently — looks
  like delivery failure but is user-side. Check user's notification
  preferences before assuming OneSignal is at fault.
- Android 15 Notification Cooldown auto-throttles repeats — don't fight it,
  our 60s coalesce on the server prevents the worst of it.
