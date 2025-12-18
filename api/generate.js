
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

  const customApiKey = getHeader('x-custom-api-key');
  const customBaseUrl = getHeader('x-custom-base-url');
  const customModel = getHeader('x-custom-model');

  let apiKey = customApiKey || process.env.API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Configuration Error: API_KEY is missing." });
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  let baseUrl = customBaseUrl || 'https://api.openai.com/v1';
  baseUrl = baseUrl.replace(/\/$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('openai.azure.com')) {
     baseUrl = `${baseUrl}/v1`;
  }

  // --- List Models (Proxy) ---
  if (request.method === 'GET' && request.query.action === 'list_models') {
    try {
      let targetUrl = `${baseUrl}/models`;
      const proxyRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (proxyRes.status === 429) {
          return response.status(429).json({ error: "Upstream Rate Limit (429). Please wait." });
      }

      const contentType = proxyRes.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        return response.status(502).json({ error: "Upstream returned HTML. Check Base URL." });
      }

      if (!proxyRes.ok) {
        const errText = await proxyRes.text();
        return response.status(proxyRes.status).json({ error: `Upstream Error: ${errText}` });
      }

      const data = await proxyRes.json();
      let models = data.data || data.models || (Array.isArray(data) ? data : []);
      return response.status(200).json({ success: true, models: models });

    } catch (error) {
      return response.status(500).json({ error: error.message });
    }
  }

  // --- Generate ---
  if (request.method === 'POST') {
    try {
      const { date } = request.body;
      if (!date) return response.status(400).json({ error: "Date is required" });

      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const primaryModel = customModel || process.env.GEMINI_MODEL_ID || 'gemini-1.5-pro';
      const fallbackModel = 'gpt-4o-mini';

      const attempt = async (mId, retryLevel = 0) => {
         try {
            const requestOptions = {
                model: mId,
                messages: [
                    { role: "system", content: `You are an editor. Search real news for ${date}. No hallucinations. Bilingual JSON output.` },
                    { role: "user", content: `Generate news briefing for ${date}` }
                ],
                response_format: { type: "json_object" }
            };

            if (mId.toLowerCase().includes('gemini')) {
                requestOptions.tools = [{ type: "function", function: { name: "google_search_retrieval", description: "Google Search", parameters: { type: "object", properties: {} } } }];
            }

            const completion = await client.chat.completions.create(requestOptions);
            if (!completion || !completion.choices || completion.choices.length === 0) {
                 throw new Error("Empty choices in model response.");
            }

            const text = completion.choices[0].message.content;
            return JSON.parse(text);
         } catch (err) {
             const msg = err.message || "";
             if (msg.includes("429") || msg.includes("Rate limit")) {
                 if (retryLevel < 1 && mId !== fallbackModel) {
                     await new Promise(r => setTimeout(r, 1500));
                     return attempt(fallbackModel, 1);
                 }
                 throw new Error("Upstream Rate Limit Exceeded (429). Please try later.");
             }
             if (retryLevel === 0 && mId !== fallbackModel) {
                 return attempt(fallbackModel, 1);
             }
             throw err;
         }
      };

      const data = await attempt(primaryModel);
      return response.status(200).json(data);

    } catch (error) {
      return response.status(500).json({ error: error.message });
    }
  }

  return response.status(405).json({ error: "Method not allowed" });
}
