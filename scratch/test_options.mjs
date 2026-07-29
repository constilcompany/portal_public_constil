import 'dotenv/config';

async function testUpdate() {
  const url = process.env.VITE_APP_API_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const token = 'eyJ...'; // Need a valid JWT. Or we can just try OPTIONS request!

  const response = await fetch(`${url}/profiles?user_id=eq.b22`, {
    method: 'OPTIONS',
    headers: {
      'apikey': anonKey
    }
  });
  
  console.log('OPTIONS status:', response.status);
  console.log('OPTIONS headers:', response.headers);
  const text = await response.text();
  console.log('OPTIONS body:', text);
}

testUpdate();
