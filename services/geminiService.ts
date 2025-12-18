
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
  if (!url.match(/\/v1(\/|$)/) && !url.includes('/api/')) {
       if (!url.endsWith('/v1')) {
           url = `${url}/v1`;
       }
  } else if (url.endsWith('/')) {
       url = url.slice(0, -1);
  }
  
  return { baseUrl: url };
};

// --- Tavern-Style Connection Logic ---

export const connectToOpenAI = async (config: UserConfig): Promise<{ id: string, name?: string }[]> => {
    const apiKey = config.apiKey?.trim();
    const { baseUrl } = parseUrlConfig(config.baseUrl);
    
    if (!apiKey) throw new Error("缺少 API Key");

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
    
    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
        dangerouslyAllowBrowser: true
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
      You are a senior news editor and bilingual content creator.
      
      CRITICAL INSTRUCTION:
      You MUST retrieve REAL news from the internet for the date: ${targetDate}.
      DO NOT HALLUCINATE. DO NOT MAKE UP NEWS.
      If you cannot access the internet or search tools, or if you cannot find news for this specific date, return an error JSON or state "OFFLINE_MODE".
      
      Task:
      1. Search/Review ACTUAL global news and medical breakthroughs from YESTERDAY (${targetDate}).
      2. Select 6 major Global/Politics/Economy stories.
      3. Select 6 major Medical/Health/Science stories.
      
      Requirements:
      - 'source_url' MUST be a real, valid URL. Do not invent URLs.
      - 'source_name' must be the actual publisher (e.g., Reuters, CNN, Nature).
      - Titles must be catchy (Xiaohongshu style) but FACTUAL.
      - Bilingual (CN/EN).
      
      IMPORTANT: Output ONLY valid JSON.
      ${jsonStructure}
    `;

    // Helper to determine if we should inject Google Tools
    const isGemini = userModelId.toLowerCase().includes('gemini');

    // Retry Helper
    const attemptGenerate = async (mId: string, retryLevel = 0): Promise<GeneratedContent> => {
        try {
            console.log(`Generating with ${mId} via ${baseUrl}...`);
            
            const requestOptions: any = {
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Search for real news on ${targetDate} and generate the briefing.` }
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
            };

            // Inject Google Search Tool if it's a Gemini model
            // This relies on the Proxy passing the 'tools' payload correctly to Google
            if (isGemini) {
                requestOptions.tools = [
                    {
                        type: "function",
                        function: {
                            name: "google_search_retrieval",
                            description: "Access Google Search to find real-time information.",
                            parameters: { type: "object", properties: {} }
                        }
                    }
                ];
            }

            const completion = await client.chat.completions.create(requestOptions);

            if (!completion || !completion.choices || completion.choices.length === 0) {
                console.error("Invalid Response Structure:", completion);
                throw new Error("Model response invalid: 'choices' field missing. The proxy might be returning an error or malformed data.");
            }

            const contentStr = completion.choices[0].message.content;
            if (!contentStr) throw new Error("Empty response content from model");
            
            const parsed = JSON.parse(contentStr);
            
            // Simple validation check for hallucinations (empty URLs or generic placeholders)
            if (parsed.general_news && parsed.general_news.length > 0) {
                const sampleUrl = parsed.general_news[0].source_url;
                if (!sampleUrl || sampleUrl.includes("example.com") || sampleUrl === "String") {
                    throw new Error("Model detected to be hallucinating (Fake URLs). Please use a model with Internet Access.");
                }
            }

            return parsed;

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
            const isHallucination = msg.includes("hallucinating");
            
            // Logic for fallbacks
            if (isNotFound || isAuthError || isMalformed || isHallucination || retryLevel < 2) {
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
