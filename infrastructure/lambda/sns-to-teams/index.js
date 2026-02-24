/**
 * SNS to Microsoft Teams webhook Lambda
 * Forwards CloudWatch alarm notifications from SNS to a Microsoft Teams incoming webhook.
 * Uses MessageCard format. Environment: TEAMS_WEBHOOK_URL
 */
exports.handler = async (event) => {
  const webhook = process.env.TEAMS_WEBHOOK_URL;
  if (!webhook) {
    console.warn('TEAMS_WEBHOOK_URL not set');
    return { statusCode: 200 };
  }
  for (const r of event.Records || []) {
    try {
      const msg = JSON.parse(r.Sns.Message);
      const state = msg.NewStateValue || 'UNKNOWN';
      const themeColor = state === 'ALARM' ? 'FF0000' : state === 'OK' ? '00CC00' : 'FFA500';
      const reason = msg.NewStateReason || state;
      const metric = msg.Trigger
        ? `${msg.Trigger.MetricName || ''} (${msg.Trigger.Namespace || ''})`
        : '';
      const card = {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor,
        summary: `${msg.AlarmName || 'Alarm'} - ${state}`,
        sections: [
          {
            activityTitle: `${msg.AlarmName || 'Alarm'} → ${state}`,
            facts: [
              { name: 'State', value: state },
              ...(msg.Region ? [{ name: 'Region', value: msg.Region }] : []),
              ...(msg.StateChangeTime ? [{ name: 'Time', value: msg.StateChangeTime }] : []),
            ],
            text: [reason, metric].filter(Boolean).join('\n\n'),
          },
        ],
      };
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });
      if (!res.ok) {
        console.error('Teams webhook failed:', res.status, await res.text());
      }
    } catch (e) {
      console.error('SNS-to-Teams error:', e);
    }
  }
  return { statusCode: 200 };
};
