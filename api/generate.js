
import { GoogleGenAI, Type } from "@google/genai";

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

  // Critical fix: Remove 'models/' prefix if present.
  // REMOVED encoding logic.
  const sanitizeModelName = (name) => {
      if (!name) return name;
      return name.replace(/^models\//i, '');
  };

  // 1. Config Parsing
  const customApiKey = getHeader('x-custom-api-key');
  const customBaseUrl = getHeader('x-custom-base-url');
  const customModel = getHeader('x-custom-model');

  let apiKey = customApiKey || process.env.API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Configuration Error: API_KEY is missing." });
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  let baseUrl = 'https://generativelanguage.googleapis.com';
  let apiVersion = 'v1beta';

  if (customBaseUrl && customBaseUrl.trim() !== '') {
    let url = customBaseUrl.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    
    // Auto-detect version from URL
    if (url.endsWith('/v1')) {
        apiVersion = 'v1';
        url = url.substring(0, url.length - 3);
    } else if (url.endsWith('/v1beta')) {
        apiVersion = 'v1beta';
        url = url.substring(0, url.length - 7);
    }
    
    baseUrl = url.replace(/\/$/, '');
  }

  // --- List Models (Proxy) ---
  if (request.method === 'GET' && request.query.action === 'list_models') {
    try {
      const targetUrl = `${baseUrl}/v1/models`; 
      console.log(`[Proxy List] Forwarding to: ${targetUrl}`);

      const proxyRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

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

      const ai = new GoogleGenAI({ 
          apiKey, 
          baseUrl, 
          apiVersion,
          requestOptions: {
            customHeaders: {
                'Authorization': `Bearer ${apiKey}`
            }
          }
      });
      
      const primaryModel = customModel || process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';
      const fallbackModel = 'gemini-1.5-pro';
      const secondaryFallbackModel = 'gemini-1.5-flash';

      const newsItemSchema = {
        type: Type.OBJECT,
        properties: {
          title_cn: { type: Type.STRING },
          title_en: { type: Type.STRING },
          summary_cn: { type: Type.STRING },
          summary_en: { type: Type.STRING },
          source_url: { type: Type.STRING },
          source_name: { type: Type.STRING },
        },
      };

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          viral_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
          medical_viral_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
          general_news: { type: Type.ARRAY, items: newsItemSchema },
          medical_news: { type: Type.ARRAY, items: newsItemSchema },
          date: { type: Type.STRING },
        },
      };

      const prompt = `
        你是一位专业的资深新闻编辑和双语内容创作者。
        任务：搜索昨日（${date}）的新闻，精选 6 条全球时政新闻和 6 条医学文献突破。
        要求：使用 Google Search，提供 source_url，双语对应，生成爆款标题。
      `;

      const genConfig = {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      };

      const attempt = async (mId, retryLevel = 0) => {
         const cleanId = sanitizeModelName(mId);
         console.log(`Generating with ${cleanId} @ ${baseUrl}/${apiVersion} (Level ${retryLevel})`);
         try {
            const result = await ai.models.generateContent({
                model: cleanId,
                contents: prompt,
                config: genConfig,
            });
            return JSON.parse(result.text);
         } catch (err) {
             const msg = err.message || JSON.stringify(err);
             const isNotFound = msg.includes('404') || msg.includes('NOT_FOUND') || (err.error && err.error.code === 404);
             
             if (isNotFound) {
                 if (retryLevel === 0 && mId !== fallbackModel) {
                     console.warn(`Model ${mId} 404. Falling back to ${fallbackModel}`);
                     return attempt(fallbackModel, 1);
                 }
                 if (retryLevel === 1 && mId !== secondaryFallbackModel) {
                     console.warn(`Model ${mId} 404. Falling back to ${secondaryFallbackModel}`);
                     return attempt(secondaryFallbackModel, 2);
                 }
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
