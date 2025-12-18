
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedContent, UserConfig } from "../types";

// UI Display Fallback
export const PRIMARY_MODEL = 'gemini-3-pro-preview';
export const FALLBACK_MODEL = 'gemini-1.5-pro'; 
export const SECONDARY_FALLBACK_MODEL = 'gemini-1.5-flash';

// Helper to sanitize model name
// Critical fix: Remove 'models/' prefix.
// REMOVED encoding logic to prevent double-encoding on proxies.
const sanitizeModelName = (name: string) => {
    if (!name) return name;
    // Strip 'models/' prefix if it exists (case insensitive)
    return name.replace(/^models\//i, '');
};

// Advanced URL Parser to handle v1 vs v1beta logic
const parseUrlConfig = (urlStr?: string) => {
  if (!urlStr) return { baseUrl: 'https://generativelanguage.googleapis.com', version: 'v1beta' };
  let url = urlStr.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  
  // Remove trailing slash for consistency
  url = url.replace(/\/$/, '');

  let version = 'v1beta';
  
  // Detect explicit version in user input
  if (url.endsWith('/v1')) {
      version = 'v1';
      url = url.substring(0, url.length - 3); // Remove /v1
  } else if (url.endsWith('/v1beta')) {
      version = 'v1beta';
      url = url.substring(0, url.length - 7); // Remove /v1beta
  }
  
  return { baseUrl: url, version };
};

// --- Tavern-Style Connection Logic ---

export const connectToOpenAI = async (config: UserConfig): Promise<{ id: string, name?: string }[]> => {
    const apiKey = config.apiKey?.trim();
    const { baseUrl } = parseUrlConfig(config.baseUrl);
    
    if (!apiKey) throw new Error("缺少 API Key");

    // OpenAI standard listing endpoint
    const targetUrl = `${baseUrl}/v1/models`;

    try {
        console.log(`[Connection] Direct fetch: ${targetUrl}`);
        
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

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

    const { baseUrl, version } = parseUrlConfig(config?.baseUrl);
    
    // Initialize SDK with detected version and force Auth Headers for proxies
    const ai = new GoogleGenAI({ 
        apiKey: apiKey, 
        baseUrl: baseUrl,
        apiVersion: version,
        requestOptions: {
            customHeaders: {
                'Authorization': `Bearer ${apiKey}`
            }
        }
    } as any);
    
    const userModelId = config?.modelId || PRIMARY_MODEL;
    
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
      任务：
      1. 搜索昨日（${targetDate}）的新闻。
      2. 精选 6 条重大的全球/政治/经济新闻。
      3. 精选 6 条重大的医学/健康/科学文献突破。
      关键要求：
      - 必须使用 Google Search 工具。
      - 必须提供真实、可访问的 source_url。
      - 为医学板块生成 3 个小红书风格爆款标题 (medical_viral_titles)。
      - 为时政板块生成 3 个小红书风格爆款标题 (viral_titles)。
      - 双语对应。
    `;

    const genConfig: any = {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    };

    // Retry Helper
    const attemptGenerate = async (mId: string, retryLevel = 0): Promise<GeneratedContent> => {
        // ALWAYS sanitize/clean model ID (strip 'models/' prefix)
        const cleanId = sanitizeModelName(mId);
        
        try {
            console.log(`Generating with ${cleanId} via ${baseUrl}/${version}...`);
            const result = await ai.models.generateContent({
              model: cleanId,
              contents: prompt,
              config: genConfig,
            });
            if (!result.text) throw new Error("Empty response from model");
            return JSON.parse(result.text);
        } catch (e: any) {
            const msg = e.message || JSON.stringify(e);
            console.warn(`Attempt failed for ${cleanId}:`, msg);

            const isNotFound = msg.includes('404') || msg.includes('NOT_FOUND') || (e.error && e.error.code === 404);
            
            // Logic for fallbacks
            if (isNotFound) {
                if (retryLevel === 0 && mId !== FALLBACK_MODEL) {
                     console.warn(`Model ${mId} 404. Trying fallback 1: ${FALLBACK_MODEL}`);
                     return attemptGenerate(FALLBACK_MODEL, 1);
                }
                if (retryLevel === 1 && mId !== SECONDARY_FALLBACK_MODEL) {
                     console.warn(`Model ${mId} 404. Trying fallback 2: ${SECONDARY_FALLBACK_MODEL}`);
                     return attemptGenerate(SECONDARY_FALLBACK_MODEL, 2);
                }
            }
            
            throw e;
        }
    };

    return await attemptGenerate(userModelId);
};
