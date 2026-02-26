import fs from 'fs';
fetch('http://localhost:3000/api/bot/status')
  .then(res => res.json())
  .then(data => {
    fs.writeFileSync('bot_status.json', JSON.stringify(data, null, 2));
  });
