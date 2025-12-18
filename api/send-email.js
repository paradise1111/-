
// api/send-email.js
export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // Sanitize Config: Remove quotes and trim whitespace
  const resendApiKey = (process.env.RESEND_API_KEY || '').replace(/['"]/g, '').trim();
  
  // Handle From Email
  let fromEmailRaw = process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>';
  let fromEmail = fromEmailRaw.replace(/['"]/g, '').trim();

  // Basic validation for From Email
  if (!fromEmail.includes('@') || !fromEmail.includes('.')) {
      console.warn(`Invalid EMAIL_FROM format (${fromEmail}), reverting to default.`);
      fromEmail = 'Aurora News <onboarding@resend.dev>';
  }

  if (!resendApiKey) {
    return response.status(500).json({ error: 'Server configuration error: Missing Resend API Key' });
  }

  try {
    const { to, subject, html } = request.body;

    if (!to || !subject || !html) {
      return response.status(400).json({ error: 'Missing required fields' });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail, 
        to: to,
        subject: subject,
        html: html,
      }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      // Parse JSON error if possible to be cleaner
      try {
          const errObj = JSON.parse(errorText);
          throw new Error(`Resend Error: ${errObj.message || errorText}`);
      } catch (e) {
          throw new Error(`Resend API rejected: ${errorText}`);
      }
    }

    const data = await resendRes.json();
    return response.status(200).json(data);

  } catch (error) {
    console.error('Email sending failed:', error);
    return response.status(500).json({ error: error.message });
  }
}
