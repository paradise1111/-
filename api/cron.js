
// api/cron.js
import OpenAI from "openai";

export default async function handler(request, response) {
  console.log("⏰ Cron Job Started: Generating Daily Briefing...");

  let apiKey = (process.env.API_KEY || '').replace(/['"]/g, '').trim();
  let baseUrl = (process.env.API_BASE_URL || 'https://api.openai.com/v1').replace(/['"]/g, '').trim(); 
  const resendApiKey = (process.env.RESEND_API_KEY || '').replace(/['"]/g, '').trim();
  
  let fromEmail = (process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>').replace(/['"]/g, '').trim();
  if (!fromEmail.includes('@')) fromEmail = 'Aurora News <onboarding@resend.dev>';

  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-1.5-pro';
  const recipientsEnv = process.env.RECIPIENT_LIST;
  const recipients = recipientsEnv ? recipientsEnv.split(',').map(e => e.trim()).filter(e => e) : [];

  if (!apiKey || !resendApiKey || recipients.length === 0) {
    return response.status(500).json({ error: "Configuration missing" });
  }

  baseUrl = baseUrl.replace(/\/$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('openai.azure.com')) {
     baseUrl = `${baseUrl}/v1`;
  }

  // Helper: Extract and Repair JSON
  const extractAndRepairJson = (str) => {
    if (!str) return "";
    const firstOpen = str.indexOf('{');
    const lastClose = str.lastIndexOf('}');
    let jsonCandidate = str;
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      jsonCandidate = str.substring(firstOpen, lastClose + 1);
    } else {
      jsonCandidate = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    }
    // Fix trailing commas
    jsonCandidate = jsonCandidate.replace(/,(\s*[}\]])/g, '$1');
    return jsonCandidate;
  };

  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const yesterday = new Date(beijingTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateStr = yesterday.toISOString().split('T')[0];

  try {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });

    const jsonStructure = `
      {
        "viral_titles": ["String"],
        "medical_viral_titles": ["String"],
        "general_news": [{ "title_cn": "String", "title_en": "String", "summary_cn": "String", "summary_en": "String", "source_url": "String", "source_name": "String" }],
        "medical_news": [{ "title_cn": "String", "title_en": "String", "summary_cn": "String", "summary_en": "String", "source_url": "String", "source_name": "String" }],
        "date": "YYYY-MM-DD"
      }
    `;

    const prompt = `
      Task: Search for ${targetDateStr} news.
      CRITICAL: Use REAL Internet Search. NO HALLUCINATIONS.
      Requirements: Valid source_url required. Bilingual.
      Output: Strictly Valid JSON ONLY. Do not use Markdown code blocks.
      Structure: ${jsonStructure}
    `;

    console.log(`Generating content for ${targetDateStr} using ${modelId}...`);

    const requestOptions = {
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096
    };

    // REMOVED: tools injection

    const completion = await client.chat.completions.create(requestOptions);

    if (!completion || !completion.choices || completion.choices.length === 0) {
        throw new Error(`Invalid response structure.`);
    }

    const choice = completion.choices[0];
    if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
        throw new Error("Content blocked by safety filter.");
    }

    const contentText = extractAndRepairJson(choice.message.content);
    const content = JSON.parse(contentText);
    
    // HTML Generation
    const generateHtml = (data) => {
      const listItems = (items, color) => items.map(item => `
        <div style="margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px;">
          <div style="font-weight: bold; margin-bottom: 5px;"><a href="${item.source_url}" style="color: #333; text-decoration: none;">${item.title_cn}</a></div>
          <div style="font-size: 14px; color: #666;">${item.title_en}</div>
          <div style="font-size: 14px; color: #444; margin-top: 5px;">${item.summary_cn}</div>
        </div>
      `).join('');

      return `
        <h1>Aurora Daily Briefing - ${data.date}</h1>
        <div style="background:#fff0f6; padding:15px; border-radius:8px; margin-bottom:20px;">
          <b style="color:#c41d7f">🔥 Global Viral:</b><br/>
          ${data.viral_titles.join('<br/>')}
        </div>
        <div style="background:#f6ffed; padding:15px; border-radius:8px; margin-bottom:20px;">
          <b style="color:#52c41a">🩺 Health Viral:</b><br/>
          ${data.medical_viral_titles ? data.medical_viral_titles.join('<br/>') : ''}
        </div>
        <h3 style="color:#1677ff">🌍 Global News</h3>
        ${listItems(data.general_news, '#1677ff')}
        <h3 style="color:#52c41a">🧬 Medical News</h3>
        ${listItems(data.medical_news, '#52c41a')}
      `;
    };

    const htmlContent = generateHtml(content);

    // Send Email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: `[Aurora] Daily Briefing - ${targetDateStr}`,
        html: htmlContent,
      }),
    });

    if (!emailRes.ok) throw new Error(await emailRes.text());
    
    return response.status(200).json({ success: true, date: targetDateStr });

  } catch (error) {
    console.error("Cron Job Failed:", error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
