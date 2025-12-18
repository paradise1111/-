
import OpenAI from "openai";

export default async function handler(request, response) {
  // CORS
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-custom-api-key, x-custom-base-url, x-custom-model');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const getHeader = (key) => {
    const val = request.headers[key];
    if (!val) return undefined;
    try { return decodeURIComponent(val); } catch (e) { return val; }
  };

  // 1. Config Parsing
  const customApiKey = getHeader('x-custom-api-key');
  const customBaseUrl = getHeader('x-custom-base-url');
  const customModel = getHeader('x-custom-model');

  let apiKey = customApiKey || process.env.API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Configuration Error: API_KEY is missing." });
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  let baseUrl = customBaseUrl || 'https://api.openai.com/v1';
  // Normalize Base URL
  baseUrl = baseUrl.replace(/\/$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('openai.azure.com')) {
     baseUrl = `${baseUrl}/v1`;
  }

  // --- List Models (Proxy) ---
  if (request.method === 'GET' && request.query.action === 'list_models') {
    try {
      let targetUrl = `${baseUrl}/models`;

      console.log(`[Proxy List] Forwarding to: ${targetUrl}`);

      const proxyRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const contentType = proxyRes.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        return response.status(502).json({ error: "Upstream returned HTML. Check Base URL." });
      }

      if (!proxyRes.ok) {
        const errText = await proxyRes.text();
        return response.status(proxyRes.status).json({ error: `Upstream Error: ${errText}` });
      }

      const data = await proxyRes.json();
      let models = [];
      if (data.data) models = data.data;
      else if (data.models) models = data.models;
      else if (Array.isArray(data)) models = data;

      return response.status(200).json({ success: true, models: models });

    } catch (error) {
      console.error("List Proxy Failed:", error);
      return response.status(500).json({ error: error.message });
    }
  }

  // --- Ping ---
  if (request.method === 'GET' && request.query.check === 'true') {
    return response.status(200).json({ success: true, msg: "Backend Online" });
  }

  // --- Generate ---
  if (request.method === 'POST') {
    try {
      const { date } = request.body;
      if (!date) return response.status(400).json({ error: "Date is required" });

      const client = new OpenAI({
          apiKey: apiKey,
          baseURL: baseUrl,
      });
      
      const primaryModel = customModel || process.env.GEMINI_MODEL_ID || 'gemini-1.5-pro';
      const fallbackModel = 'gpt-4o-mini';

      const jsonStructure = `
      {
        "viral_titles": ["String (3 global news viral titles)"],
        "medical_viral_titles": ["String (3 medical/health viral titles)"],
        "general_news": [
          {
            "title_cn": "String",
            "title_en": "String",
            "summary_cn": "String",
            "summary_en": "String",
            "source_url": "String",
            "source_name": "String"
          }
        ],
        "medical_news": [
          {
            "title_cn": "String",
            "title_en": "String",
            "summary_cn": "String",
            "summary_en": "String",
            "source_url": "String",
            "source_name": "String"
          }
        ],
        "date": "YYYY-MM-DD"
      }
      `;

      const systemPrompt = `
        你是一位专业的资深新闻编辑和双语内容创作者。
        任务：搜索昨日（${date}）的新闻，精选 6 条全球时政新闻和 6 条医学文献突破。
        要求：
        1. 提供真实 source_url。
        2. 双语对应。
        3. 小红书风格标题。
        
        IMPORTANT: Output valid JSON only. Structure:
        ${jsonStructure}
      `;

      const attempt = async (mId, retryLevel = 0) => {
         console.log(`Generating with ${mId} @ ${baseUrl} (Level ${retryLevel})`);
         try {
            const completion = await client.chat.completions.create({
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Start" }
                ],
                response_format: { type: "json_object" }
            });

            // SAFETY CHECK
            if (!completion || !completion.choices || completion.choices.length === 0) {
                 throw new Error(`Invalid response structure from model: choices missing. Response: ${JSON.stringify(completion)}`);
            }

            const text = completion.choices[0].message.content;
            return JSON.parse(text);
         } catch (err) {
             const msg = err.message || JSON.stringify(err);
             console.warn(`Error with ${mId}: ${msg}`);

             if (msg.includes("<!doctype html>") || msg.includes("<html")) {
                 throw new Error("Upstream returned HTML (Dashboard) instead of JSON. Check Base URL.");
             }
             
             if (retryLevel === 0 && mId !== fallbackModel) {
                 console.warn(`Falling back to ${fallbackModel}`);
                 return attempt(fallbackModel, 1);
             }
             throw err;
         }
      };

      try {
          const data = await attempt(primaryModel);
          return response.status(200).json(data);
      } catch (err) {
          console.error("All generation attempts failed:", err);
          const errorMsg = err.response ? JSON.stringify(err.response) : err.message;
          return response.status(500).json({ error: errorMsg });
      }

    } catch (error) {
      console.error("Global Error:", error);
      return response.status(500).json({ error: error.message });
    }
  }

  return response.status(405).json({ error: "Method not allowed" });
}
