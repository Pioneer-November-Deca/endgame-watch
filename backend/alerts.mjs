import { CAMPAIGN_ID, shouldAlert } from './domain.mjs';
import { pool } from './database.mjs';
import { alertReady, sendAlert } from './mailgun.mjs';

export async function considerAlert(observation) {
  if (!alertReady() || !shouldAlert(observation)) return;
  const claim = await pool.query(`INSERT INTO watch_alert(campaign_id,status,observed_seconds)
    VALUES($1,'sending',$2) ON CONFLICT(campaign_id) DO NOTHING RETURNING campaign_id`, [CAMPAIGN_ID, observation.seconds]);
  if (!claim.rowCount) return;
  // A database stall must not turn a near-end alert into an after-end email.
  if (!shouldAlert(observation)) {
    await pool.query("UPDATE watch_alert SET status='skipped-expired' WHERE campaign_id=$1", [CAMPAIGN_ID]); return;
  }
  try {
    const result = await sendAlert(observation.seconds);
    await pool.query('UPDATE watch_alert SET status=$1,provider_id=$2 WHERE campaign_id=$3',
      [result.ok ? 'accepted' : 'rejected', result.id, CAMPAIGN_ID]);
    console.log(JSON.stringify({ event: 'campaign.near_end', status: result.ok ? 'accepted' : 'rejected', seconds: observation.seconds }));
  } catch {
    await pool.query("UPDATE watch_alert SET status='delivery-unknown' WHERE campaign_id=$1", [CAMPAIGN_ID]);
    console.error('alert_delivery_unknown_check_mailgun_logs');
  }
}
