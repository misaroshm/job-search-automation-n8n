// Reads the result of getUpdates. Returns nothing when there are no new messages
// (the run stops there), otherwise one item with the updates and the call that
// confirms them right away, so a run that overlaps this one never sees them again.
//
// Polling instead of a webhook: the bot works on a laptop that sleeps,
// so nothing on the internet has to reach it.

const res = $input.first().json || {};

if (res.ok === false && res.error_code === 409) {
  // A webhook is still set somewhere (old setup): remove it, polling continues next tick
  return [{ json: { method: 'deleteWebhook', body: { drop_pending_updates: false }, updates: [] } }];
}

const updates = Array.isArray(res.result) ? res.result : [];
if (!updates.length) return [];

const last = Math.max(...updates.map((u) => u.update_id));
return [{ json: {
  method: 'getUpdates',
  body: { offset: last + 1, limit: 1, timeout: 0 },
  updates,
} }];
