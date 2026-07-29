const axios = require('axios');

const supabaseUrl = 'https://avppbvsxayehguepyjkb.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cHBidnN4YXllaGd1ZXB5amtiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAzMzk2MiwiZXhwIjoyMDkyNjA5OTYyfQ.IjIDpaxklgfczNpmHlrKAThnGzlECeMwtv9QodFPwZk';

async function listFiles() {
  try {
    const response = await axios.post(`${supabaseUrl}/storage/v1/object/list/ai-inputs`, {
      prefix: '',
      limit: 10,
      sortBy: { column: 'name', order: 'asc' }
    }, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log("ai-inputs files:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) console.log(error.response.data);
  }
}

listFiles();
