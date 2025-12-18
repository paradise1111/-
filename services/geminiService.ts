
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

// Helper: Robust JSON Extraction & Repair
const extractAndRepairJson = (str: string): string => {
  if (!str) return "";
  
  // 1. Extract content between first { and last }
  const firstOpen = str.indexOf('{');
  const lastClose = str.lastIndexOf('}');
  
  let jsonCandidate = str;
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    jsonCandidate = str.substring(firstOpen, lastClose + 1);
  } else {
    // Fallback cleanup if braces aren't clear
    jsonCandidate = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // 2. Fix Trailing Commas
  jsonCandidate = jsonCandidate.replace(/,(\s*[}\]])/g, '$1');

  // 3. Attempt to fix unescaped newlines within strings (Risky but necessary for Gemini)
  // This is a simple heuristic: if we see a newline that is NOT followed by a whitespace and a key, it might be in a string.
  // Ideally, we rely on the Prompt to fix this.

  return jsonCandidate;
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

    // Enhanced System Prompt for Stability
    const systemPrompt = `You are a professional news editor. 
    Task: Search for REAL news from ${targetDate}. 
    
    CRITICAL OUTPUT RULES:
    1. Output strictly Valid MINIFIED JSON only.
    2. NO Markdown formatting, NO code blocks, NO text before/after.
    3. ESCAPE RULES:
       - Escape all double quotes inside strings (e.g., \\")
       - Escape all newlines inside strings (e.g., \\n) - DO NOT use actual line breaks in values.
    4. Content must be bilingual (Chinese/English).
    5. Keep summaries concise (under 50 words) to avoid truncation.`;

    const jsonStructure = `{ "viral_titles": [], "medical_viral_titles": [], "general_news": [], "medical_news": [], "date": "${targetDate}" }`;

    const attempt = async (mId: string, retryCount: number = 0): Promise<GeneratedContent> => {
        try {
            console.log(`[Attempt ${retryCount + 1}] Using ${mId}...`);
            
            const options: any = {
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Retrieve REAL news for ${targetDate}. Return raw minified JSON matching: ${jsonStructure}` }
                ],
                // Lower temperature for deterministic formatting
                temperature: 0.3,
                max_tokens: 4096
            };

            const completion = await client.chat.completions.create(options);
            const choice = completion.choices[0];
            
            if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
                throw new Error("Content generation blocked by safety filters.");
            }

            let content = choice.message?.content;
            
            if (!content) {
                if (choice.message?.refusal) throw new Error(`Model Refusal: ${choice.message.refusal}`);
                throw new Error(`API returned an empty body. Finish Reason: ${choice.finish_reason}`);
            }

            // Extract and Repair JSON
            const jsonStr = extractAndRepairJson(content);
            
            try {
                const parsed = JSON.parse(jsonStr);
                if (!parsed.general_news && !parsed.viral_titles) {
                    throw new Error("JSON parsed but missing key fields.");
                }
                return parsed;
            } catch (jsonErr) {
                // Log the first 100 chars to help identify if it's garbage
                console.error("JSON Parse Error. Start of content:", jsonStr.substring(0, 100));
                
                if (choice.finish_reason === 'length') {
                    throw new Error("News content too long and JSON was truncated. Trying fallback model...");
                }
                throw new Error("Failed to parse model output as JSON (Syntax Error).");
            }

        } catch (e: any) {
            const status = e.status || (e.message?.match(/\d{3}/)?.[0]);
            console.warn(`Error with ${mId}:`, e.message);

            // Rate Limit
            if (status == 429 || e.message.includes("429")) {
                if (retryCount < 3) {
                    const waitTime = Math.pow(2, retryCount + 1) * 1000;
                    console.log(`Rate limited. Waiting ${waitTime}ms...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    return attempt(mId, retryCount + 1);
                }
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 0);
            }

            // Logic/Parse Errors: switch model immediately
            if (retryCount === 0 && mId === PRIMARY_MODEL) {
                 return attempt(FALLBACK_MODEL, 1);
            }
            if (retryCount === 0 && mId === FALLBACK_MODEL) {
                 return attempt(SECONDARY_FALLBACK_MODEL, 1);
            }

            throw new Error(e.message || "Request failed after multiple attempts.");
        }
    };

    return await attempt(userModelId);
};
