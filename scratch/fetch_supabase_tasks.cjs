const fs = require('fs');

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzM5NjIsImV4cCI6MjA5MjYwOTk2Mn0.9deO5EvQLpilKfIWdAFqfoWkKx5wOwRbdnX7o0N1Yek';

async function run() {
  const url = `${supabaseUrl}/rest/v1/tasks?select=id,title,due_date,status,raw_emails(id,subject,sender)&order=due_date.asc`;
  const res = await fetch(url, {
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`
    }
  });
  const data = await res.json();
  
  const parseSender = (senderStr) => {
    if (!senderStr) return 'Self/System';
    try {
      const parsed = JSON.parse(senderStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[0].name || parsed[0].email || 'Unknown Sender';
      }
    } catch (e) {}
    const match = senderStr.match(/^([^<]+)/);
    return match ? match[1].trim() : senderStr;
  };
  
  const hnhTasks = data.filter(t => parseSender(t.raw_emails?.sender) === 'HNHTECH SOLUTIONS');
  console.log("HNHTECH SOLUTIONS TASKS:");
  console.log(JSON.stringify(hnhTasks, null, 2));
}

run();
