
import OpenAI from "openai";
import { GeneratedContent, UserConfig } from "../types";

// UI Display Fallback
export const PRIMARY_MODEL = 'gemini-1.5-pro'; // Better default for proxies
export const FALLBACK_MODEL = 'gpt-4o-mini'; 
export const SECONDARY_FALLBACK_MODEL = 'claude-3-haiku';

// Helper to sanitize URL
const parseUrlConfig = (urlStr?: string) => {
  if (!urlStr) return { baseUrl: 'https://api.openai.com/v1' }; // Default to OpenAI if empty
  let url = urlStr.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  
  // Remove trailing slash
  url = url.replace(/\/$/, '');

  // Critical Fix: Most OpenAI compatible proxies (NewAPI/OneAPI) mount at /v1
  // If the URL doesn't end with /v1, we append it to ensure we hit the API and not the dashboard HTML.
  // Exception: If the user deliberately typed a path that isn't v1 (e.g. /v1beta), we might break it, 
  // but standardizing on /v1 is the safest bet for the "New API" error observed.
  if (!url.match(/\/v1(\/|$)/) && !url.includes('/api/')) {
       // Check if it already has a version-like suffix? 
       // Simplest robust logic: if it doesn't end in v1, append it.
       if (!url.endsWith('/v1')) {
           url = `${url}/v1`;
       }
  } else if (url.endsWith('/')) {
       // Cleanup if regex missed it
       url = url.slice(0, -1);
  }
  
  return { baseUrl: url };
};

// --- Tavern-Style Connection Logic ---

export const connectToOpenAI = async (config: UserConfig): Promise<{ id: string, name?: string }[]> => {
    const apiKey = config.apiKey?.trim();
    const { baseUrl } = parseUrlConfig(config.baseUrl);
    
    if (!apiKey) throw new Error("缺少 API Key");

    // Try standard OpenAI listing
    // Note: Some proxies mount at /v1/models, some at /models.
    // parseUrlConfig now ensures baseUrl ends in /v1 (mostly)
    let targetUrl = `${baseUrl}/models`;

    try {
        console.log(`[Connection] Direct fetch: ${targetUrl}`);
        
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
             throw new Error("Received HTML instead of JSON. Check Base URL setting (should likely end in /v1).");
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
        }

        const data = await response.json();
        
        let models: any[] = [];
        if (Array.isArray(data.data)) models = data.data;
        else if (Array.isArray(data.models)) models = data.models;
        else if (Array.isArray(data)) models = data;

        if (models.length === 0) throw new Error("连接成功，但返回的模型列表为空");

        return models
            .map((m: any) => ({ id: m.id, name: m.id }))
            .sort((a, b) => a.id.localeCompare(b.id));

    } catch (error: any) {
         // If direct fetch fails, we might try the proxy endpoint on our backend to bypass CORS
         if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            console.warn(`[Connection] Direct fetch failed (CORS?), trying proxy...`);
            return connectViaProxy(baseUrl, apiKey);
        }
        throw error;
    }
};

const connectViaProxy = async (baseUrl: string, apiKey: string) => {
    try {
        const proxyUrl = `/api/generate?action=list_models`;
        const response = await fetch(proxyUrl, {
            headers: {
                'x-custom-base-url': encodeURIComponent(baseUrl),
                'x-custom-api-key': encodeURIComponent(apiKey)
            }
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `Proxy Error: ${response.status}`);
        }

        const data = await response.json();
        return data.models.map((m: any) => ({ id: m.id, name: m.id }));
    } catch (e: any) {
        throw new Error(`连接失败: ${e.message}`);
    }
};

// --- Generation ---

export const checkConnectivity = async (config?: UserConfig): Promise<boolean> => {
    try {
        if (!config?.apiKey) return false;
        await connectToOpenAI(config);
        return true;
    } catch (e) {
        console.error("Connectivity check failed:", e);
        return false;
    }
};

export const generateBriefing = async (targetDate: string, config?: UserConfig): Promise<GeneratedContent> => {
    const apiKey = config?.apiKey || process.env.API_KEY || '';
    if (!apiKey) throw new Error("API Key is required.");

    const { baseUrl } = parseUrlConfig(config?.baseUrl);
    
    // Initialize OpenAI SDK
    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
        dangerouslyAllowBrowser: true // Required for client-side usage
    });
    
    const userModelId = config?.modelId || PRIMARY_MODEL;

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
      
      任务：
      1. 搜索/回顾昨日（${targetDate}）的新闻。
      2. 精选 6 条重大的全球/政治/经济新闻。
      3. 精选 6 条重大的医学/健康/科学文献突破。
      
      要求：
      - 必须提供真实、可访问的 source_url。
      - 为医学板块生成 3 个小红书风格爆款标题 (medical_viral_titles)。
      - 为时政板块生成 3 个小红书风格爆款标题 (viral_titles)。
      - 双语对应。
      
      IMPORTANT: You must output ONLY valid JSON matching the following structure. Do not include markdown formatting like \`\`\`json.
      ${jsonStructure}
    `;

    // Retry Helper
    const attemptGenerate = async (mId: string, retryLevel = 0): Promise<GeneratedContent> => {
        try {
            console.log(`Generating with ${mId} via ${baseUrl}...`);
            
            const completion = await client.chat.completions.create({
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Generate daily briefing for ${targetDate}` }
                ],
                response_format: { type: "json_object" }, // Force JSON mode
                temperature: 0.7,
            });

            // SAFETY CHECK: Ensure choices exist
            if (!completion || !completion.choices || completion.choices.length === 0) {
                console.error("Invalid Response Structure:", completion);
                throw new Error("Model response invalid: 'choices' field missing. The proxy might be returning an error or malformed data.");
            }

            const contentStr = completion.choices[0].message.content;
            if (!contentStr) throw new Error("Empty response content from model");
            
            return JSON.parse(contentStr);

        } catch (e: any) {
            const msg = e.message || JSON.stringify(e);
            console.warn(`Attempt failed for ${mId}:`, msg);

            // Detect HTML response in error message
            const isHtml = msg.includes("<!doctype html>") || msg.includes("<html");
            if (isHtml) {
                 throw new Error("Base URL Error: Endpoint returned HTML (Dashboard) instead of API JSON. Please check your Base URL settings (ensure it ends with /v1 if using NewAPI/OneAPI).");
            }

            const isNotFound = msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('model_not_found');
            const isAuthError = msg.includes('401') || msg.includes('403');
            const isMalformed = msg.includes("'choices' field missing");
            
            // Logic for fallbacks
            if (isNotFound || isAuthError || isMalformed || retryLevel < 2) {
                if (retryLevel === 0 && mId !== FALLBACK_MODEL) {
                     console.warn(`Model ${mId} failed. Trying fallback 1: ${FALLBACK_MODEL}`);
                     return attemptGenerate(FALLBACK_MODEL, 1);
                }
                if (retryLevel === 1 && mId !== SECONDARY_FALLBACK_MODEL) {
                     console.warn(`Model ${mId} failed. Trying fallback 2: ${SECONDARY_FALLBACK_MODEL}`);
                     return attemptGenerate(SECONDARY_FALLBACK_MODEL, 2);
                }
            }
            
            throw e;
        }
    };

    return await attemptGenerate(userModelId);
};
