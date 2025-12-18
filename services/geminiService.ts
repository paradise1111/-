
import OpenAI from "openai";
import { GeneratedContent, UserConfig } from "../types";

export const PRIMARY_MODEL = 'gemini-1.5-pro';
export const FALLBACK_MODEL = 'gemini-1.5-flash'; // Flash is much faster and has higher limits
export const SECONDARY_FALLBACK_MODEL = 'gpt-4o-mini';

const parseUrlConfig = (urlStr?: string) => {
  if (!urlStr) return { baseUrl: 'https://api.openai.com/v1' };
  let url = urlStr.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  url = url.replace(/\/$/, '');
  if (!url.match(/\/v1(\/|$)/) && !url.includes('/api/')) {
       if (!url.endsWith('/v1')) url = `${url}/v1`;
  }
  return { baseUrl: url };
};

export const connectToOpenAI = async (config: UserConfig): Promise<{ id: string, name?: string }[]> => {
    const apiKey = config.apiKey?.trim();
    const { baseUrl } = parseUrlConfig(config.baseUrl);
    if (!apiKey) throw new Error("缺少 API Key");

    try {
        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });

        if (response.status === 429) throw new Error("429: API 额度已耗尽或请求过于频繁。");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const models = data.data || data.models || (Array.isArray(data) ? data : []);
        return models.map((m: any) => ({ id: m.id, name: m.id }));
    } catch (error: any) {
        throw error;
    }
};

export const checkConnectivity = async (config?: UserConfig): Promise<boolean> => {
    try {
        if (!config?.apiKey) return false;
        await connectToOpenAI(config);
        return true;
    } catch {
        return false;
    }
};

/**
 * 带指数退避的生成函数
 */
export const generateBriefing = async (targetDate: string, config?: UserConfig): Promise<GeneratedContent> => {
    const apiKey = config?.apiKey || '';
    const { baseUrl } = parseUrlConfig(config?.baseUrl);
    const userModelId = config?.modelId || PRIMARY_MODEL;

    const client = new OpenAI({ apiKey, baseURL: baseUrl, dangerouslyAllowBrowser: true });

    const systemPrompt = `You are a professional editor. Search real news for ${targetDate}. No hallucinations. Output strictly valid JSON.`;
    const jsonStructure = `{ "viral_titles": [], "medical_viral_titles": [], "general_news": [], "medical_news": [], "date": "${targetDate}" }`;

    const attempt = async (mId: string, retryCount: number = 0): Promise<GeneratedContent> => {
        try {
            console.log(`[Attempt ${retryCount + 1}] Using ${mId}...`);
            
            const options: any = {
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Retrieve REAL news for ${targetDate}. Format: ${jsonStructure}` }
                ],
                response_format: { type: "json_object" },
                max_tokens: 2500
            };

            // Inject tools if it's a Gemini model
            if (mId.toLowerCase().includes('gemini')) {
                options.tools = [{
                    type: "function",
                    function: {
                        name: "google_search_retrieval",
                        description: "Google Search",
                        parameters: { type: "object", properties: {} }
                    }
                }];
            }

            const completion = await client.chat.completions.create(options);
            const content = completion.choices[0]?.message?.content;
            if (!content) throw new Error("API returned an empty body.");
            
            return JSON.parse(content);

        } catch (e: any) {
            const status = e.status || (e.message?.match(/\d{3}/)?.[0]);
            console.warn(`Error with ${mId}:`, e.message);

            // 429 Handling with Exponential Backoff
            if (status == 429 || e.message.includes("429")) {
                if (retryCount < 3) {
                    const waitTime = Math.pow(2, retryCount + 1) * 1000;
                    console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    return attempt(mId, retryCount + 1);
                }
                
                // If 429 persists, try switching to a different model if we are not already on one
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 0);
                if (mId === FALLBACK_MODEL) return attempt(SECONDARY_FALLBACK_MODEL, 0);
            }

            // 404/Authentication/Other errors -> direct fallback
            if (retryCount === 0) {
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 1);
            }

            throw new Error(e.message || "Request failed after multiple attempts.");
        }
    };

    return await attempt(userModelId);
};
