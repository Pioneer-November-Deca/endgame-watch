(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const raw = window.ENDGAME_CONFIG?.apiBaseUrl || '';
  let base = '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) base = url.origin;
  } catch { /* An unconfigured deployment is displayed explicitly. */ }
  let observation = null, receivedAt = 0, allowedSignup = false, submitting = false;
  function unavailable(message) {
    observation = null; allowedSignup = false; $('subscribe').disabled = true;
    $('subscribe').textContent = 'Signup temporarily unavailable';
    $('signal-badge').textContent = 'NO LIVE SIGNAL'; $('clock').textContent = '— — : — —';
    $('signal-status').textContent = '● ' + message;
  }
  function draw() {
    if (!observation || observation.sourceStatus !== 'live' || performance.now() - receivedAt > 8000) {
      $('clock').textContent = '— — : — —';
      $('signal-badge').textContent = 'NO LIVE SIGNAL';
      $('clock-caption').textContent = 'A fresh Gamefound observation is unavailable';
      return;
    }
    const age = Math.max(0, observation.serverTime - observation.observedAt) + performance.now() - receivedAt;
    if (age > (observation.freshnessMs || 15000)) { $('clock').textContent = '— — : — —'; $('signal-badge').textContent = 'STALE SIGNAL'; return; }
    const seconds = observation.deadlineAt == null ? Math.max(0, observation.seconds - Math.floor(age / 1000))
      : Math.max(0, Math.ceil((observation.deadlineAt - observation.serverTime - (performance.now() - receivedAt)) / 1000));
    $('clock').textContent = `${String(Math.floor(seconds / 3600)).padStart(2,'0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    $('signal-badge').textContent = 'LIVE SIGNAL';
    $('clock-caption').textContent = 'HOURS / MINUTES / SECONDS';
    // Display interpolation never triggers email. Only server observations do.
  }
  async function refresh() {
    try {
      const response = await fetch(base + '/api/status', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      observation = data; receivedAt = performance.now();
      allowedSignup = data.signupEnabled === true;
      $('subscribe').disabled = !allowedSignup || submitting;
      if (!submitting) $('subscribe').textContent = allowedSignup ? 'Get my near-end alert →' : 'Email signup coming soon';
      $('signal-status').textContent = data.sourceStatus === 'live' ? '● Synced with Gamefound’s public API' : data.sourceStatus === 'elapsed' ? '● Latest reported deadline has passed; no near-end alert will trigger' : '● Gamefound timer is unavailable; no alert will trigger';
      $('last-observation').textContent = data.observedAt ? 'Last watcher check: ' + new Date(data.observedAt).toLocaleTimeString() : 'No timer observation yet.';
      const delivery = { accepted: 'Mailgun accepted the near-end alert. Inbox delivery is not guaranteed.', rejected: 'Mailgun rejected the alert. Delivery needs attention.', 'delivery-unknown': 'Alert delivery is uncertain. The operator must check Mailgun logs.', sending: 'The near-end alert is being submitted.', 'skipped-expired': 'The alert observation expired before sending. No late alert was sent.' };
      $('delivery-status').textContent = delivery[data.alertStatus] || (data.alertsEnabled ? 'Near-end alerts are enabled. One alert per campaign.' : 'Alert delivery is not enabled yet.');
      if (!$('form-status').dataset.submitted) $('form-status').textContent = allowedSignup ? 'Confirm your email to join the campaign alert list.' : 'Mailgun signup is not enabled yet. No address is collected.';
      draw();
    } catch { unavailable('Backend is unavailable. Check Gamefound directly.'); }
    finally { setTimeout(refresh, 3000); }
  }
  $('signup').addEventListener('submit', async event => {
    event.preventDefault(); if (!allowedSignup || submitting) return;
    submitting = true; $('subscribe').disabled = true; $('subscribe').textContent = 'Sending confirmation…';
    $('form-status').dataset.submitted = 'true';
    try {
      const response = await fetch(base + '/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('email').value, consent: $('consent').checked, website: $('website').value }), signal: AbortSignal.timeout(20000) });
      const data = await response.json(); $('form-status').textContent = data.message;
      if (response.ok) $('signup').reset();
    } catch { $('form-status').textContent = 'Could not confirm submission. Check your inbox before trying again.'; }
    finally { submitting = false; $('subscribe').disabled = !allowedSignup; $('subscribe').textContent = 'Get my near-end alert →'; }
  });
  if (!base) {
    unavailable('Railway backend URL has not been configured yet.');
    $('form-status').textContent = 'Email signup will open after the backend is connected.';
    $('delivery-status').textContent = 'This deployment is awaiting its Railway backend.';
    $('subscribe').textContent = 'Email signup coming soon';
  } else refresh();
  setInterval(draw, 250);
})();
