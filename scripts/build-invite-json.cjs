const fs = require('fs');
const path = require('path');

const poolId = process.argv[2] || 'us-east-2_lArr8IsFK';
const siteUrl = process.argv[3] || 'cohi-dev.coheus1.com';
const sesSourceArn = process.argv[4] || 'arn:aws:ses:us-east-2:339712788893:identity/coheus1.com';

const html = fs.readFileSync(path.join(__dirname, '..', 'tmp_invite_email.html'), 'utf8')
  .replace(/\r\n/g, '\n')
  .trim()
  .replace(/\{\{SITE_URL\}\}/g, siteUrl);

const obj = {
  UserPoolId: poolId,
  AdminCreateUserConfig: {
    AllowAdminCreateUserOnly: false,
    UnusedAccountValidityDays: 7,
    InviteMessageTemplate: {
      EmailSubject: "You're invited to Coheus - sign in with your temporary password",
      EmailMessage: html
    }
  },
  EmailConfiguration: {
    EmailSendingAccount: 'DEVELOPER',
    SourceArn: sesSourceArn,
    From: 'noreply@coheus1.com',
    ReplyToEmailAddress: 'support@coheus1.com'
  },
  AutoVerifiedAttributes: ['email'],
  MfaConfiguration: 'OPTIONAL',
  UserPoolTags: {}
};
fs.writeFileSync(path.join(__dirname, '..', 'tmp_update_pool.json'), JSON.stringify(obj), 'utf8');
console.log(`Wrote tmp_update_pool.json for pool ${poolId}`);
