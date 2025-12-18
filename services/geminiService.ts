
import OpenAI from "openai";
import { GeneratedContent, UserConfig } from "../types";

export const PRIMARY_MODEL = 'gemini-1.5-pro';
export const FALLBACK_MODEL = 'gemini-1.5-flash'; 
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

// Helper: Clean JSON string from Markdown code blocks
const cleanJsonString = (str: string): string => {
  if (!str) return "";
  // Remove ```json ... ``` or ``` ... ``` wrappers
  let cleaned = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  return cleaned.trim();
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

export const generateBriefing = async (targetDate: string, config?: UserConfig): Promise<GeneratedContent> => {
    const apiKey = config?.apiKey || '';
    const { baseUrl } = parseUrlConfig(config?.baseUrl);
    const userModelId = config?.modelId || PRIMARY_MODEL;

    const client = new OpenAI({ apiKey, baseURL: baseUrl, dangerouslyAllowBrowser: true });

    // Enhanced System Prompt to enforce JSON without relying on response_format parameter
    const systemPrompt = `You are a professional news editor. 
    Task: Search for REAL news from ${targetDate}. 
    Rules:
    1. NO Hallucinations. Verify links.
    2. Output strictly Valid JSON only. No Markdown formatting, no commentary.
    3. Content must be bilingual (Chinese/English).`;

    const jsonStructure = `{ "viral_titles": [], "medical_viral_titles": [], "general_news": [], "medical_news": [], "date": "${targetDate}" }`;

    const attempt = async (mId: string, retryCount: number = 0): Promise<GeneratedContent> => {
        try {
            console.log(`[Attempt ${retryCount + 1}] Using ${mId}...`);
            
            const options: any = {
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Retrieve REAL news for ${targetDate}. Required JSON Format: ${jsonStructure}` }
                ],
                // REMOVED: response_format: { type: "json_object" } 
                // Reason: Many Gemini proxies fail with this flag. We use prompt engineering + cleaning instead.
                temperature: 0.7,
                max_tokens: 3500
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
            const choice = completion.choices[0];
            
            // Safety/Refusal Check
            if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
                throw new Error("Content generation blocked by safety filters (News/Medical topic sensitivity).");
            }

            let content = choice.message?.content;
            
            if (!content) {
                // If content is empty but refusal exists (OpenAI standard)
                if (choice.message?.refusal) {
                    throw new Error(`Model Refusal: ${choice.message.refusal}`);
                }
                throw new Error(`API returned an empty body. Finish Reason: ${choice.finish_reason}`);
            }

            // Clean Markdown wrappers
            content = cleanJsonString(content);
            
            try {
                const parsed = JSON.parse(content);
                // Basic validation
                if (!parsed.general_news && !parsed.viral_titles) {
                    throw new Error("JSON parsed but missing key fields.");
                }
                return parsed;
            } catch (jsonErr) {
                console.error("JSON Parse Error. Raw content:", content);
                throw new Error("Failed to parse model output as JSON.");
            }

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
                
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 0);
                if (mId === FALLBACK_MODEL) return attempt(SECONDARY_FALLBACK_MODEL, 0);
            }

            // Fallback for logic errors (Empty body, JSON parse fail)
            if (retryCount === 0) {
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 1);
            }

            throw new Error(e.message || "Request failed after multiple attempts.");
        }
    };

    return await attempt(userModelId);
};
