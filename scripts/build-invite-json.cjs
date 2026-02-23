const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'tmp_invite_email.html'), 'utf8');
const obj = {
  UserPoolId: 'us-east-2_lArr8IsFK',
  AdminCreateUserConfig: {
    AllowAdminCreateUserOnly: true,
    UnusedAccountValidityDays: 7,
    InviteMessageTemplate: {
      EmailSubject: "You're invited to Coheus – sign in with your temporary password",
      EmailMessage: html
    }
  }
};
fs.writeFileSync(path.join(__dirname, '..', 'tmp_update_pool.json'), JSON.stringify(obj), 'utf8');
console.log('Wrote tmp_update_pool.json');
