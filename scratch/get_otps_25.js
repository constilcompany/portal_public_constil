import axios from 'axios';

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAzMzk2MiwiZXhwIjoyMDkyNjA5OTYyfQ.IjIDpaxklgfczNpmHlrKAThnGzlECeMwtv9QodFPwZk';

async function getOTPs() {
  try {
    const response = await axios.get(`${supabaseUrl}/rest/v1/password_reset_otps?order=created_at.desc&limit=25`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
      }
    });
    console.log('Last 25 OTPs:');
    response.data.forEach(item => {
      console.log(`- Email: ${item.email}, Code: ${item.otp_code}, Created: ${item.created_at}, Used: ${item.used}`);
    });
  } catch (error) {
    console.log('Error:', error.message);
  }
}

getOTPs();
