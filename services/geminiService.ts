
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

// Helper: Attempt to balance truncated JSON (Auto-Close Brackets)
const balanceJson = (jsonStr: string): string => {
    let stack: string[] = [];
    let inString = false;
    let isEscaped = false;
    
    // Scan string to find open brackets
    for (const char of jsonStr) {
        if (inString) {
            if (char === '\\') isEscaped = !isEscaped;
            else if (char === '"' && !isEscaped) inString = false;
            else isEscaped = false;
        } else {
            if (char === '"') inString = true;
            else if (char === '{') stack.push('}');
            else if (char === '[') stack.push(']');
            else if (char === '}') {
                if (stack.length && stack[stack.length - 1] === '}') stack.pop();
            }
            else if (char === ']') {
                if (stack.length && stack[stack.length - 1] === ']') stack.pop();
            }
        }
    }
    
    // Recover: Close string if open
    let recovery = "";
    if (inString) recovery += '"';
    
    // Recover: Close brackets in reverse order
    while (stack.length > 0) {
        recovery += stack.pop();
    }
    
    return jsonStr + recovery;
};

// Helper: Robust JSON Extraction & Repair
const extractAndRepairJson = (str: string): string => {
  if (!str) return "";
  
  // 1. Remove Markdown code blocks
  let cleanStr = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

  // 2. Find the first '{'
  const firstOpen = cleanStr.indexOf('{');
  if (firstOpen === -1) return cleanStr; // No JSON object found
  
  // Cut garbage before JSON
  cleanStr = cleanStr.substring(firstOpen);

  // 3. Fix Trailing Commas (Common Gemini Issue)
  cleanStr = cleanStr.replace(/,(\s*[}\]])/g, '$1');

  // 4. Try parsing. If fail, try balancing.
  try {
      JSON.parse(cleanStr);
      return cleanStr; // It's valid!
  } catch (e) {
      // If invalid, try to balance it (assuming truncation)
      return balanceJson(cleanStr);
  }
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

    // Enhanced System Prompt for Safety & JSON Stability
    const systemPrompt = `You are a professional News Aggregator. 
    Task: Search for public news articles from ${targetDate}.
    
    SAFETY GUIDELINES:
    1. Summarize public health news ONLY. DO NOT provide medical advice.
    2. If sensitive topics arise, stick to factual reporting from reputable sources.
    
    FORMATTING RULES:
    1. Output strictly Valid JSON.
    2. LIMIT to 4 items per category to ensure completeness.
    3. Escape all quotes (\\") and newlines (\\n) in strings.`;

    const jsonStructure = `{ "viral_titles": [], "medical_viral_titles": [], "general_news": [], "medical_news": [], "date": "${targetDate}" }`;

    const attempt = async (mId: string, retryCount: number = 0): Promise<GeneratedContent> => {
        try {
            console.log(`[Attempt ${retryCount + 1}] Using ${mId}...`);
            
            const options: any = {
                model: mId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Retrieve REAL news for ${targetDate}. Return JSON matching: ${jsonStructure}` }
                ],
                temperature: 0.3,
                max_tokens: 8192, // Maximize token limit
                response_format: { type: "json_object" } // Force JSON mode
            };

            const completion = await client.chat.completions.create(options);
            const choice = completion.choices[0];
            
            if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'safety') {
                throw new Error("Content generation blocked by safety filters.");
            }

            let content = choice.message?.content;
            
            if (!content) {
                if (choice.message?.refusal) throw new Error(`Model Refusal: ${choice.message.refusal}`);
                throw new Error(`API returned an empty body.`);
            }

            // Extract and Repair JSON
            const jsonStr = extractAndRepairJson(content);
            
            try {
                const parsed = JSON.parse(jsonStr);
                
                // Fallback: If array is empty, ensure it exists
                if (!parsed.general_news) parsed.general_news = [];
                if (!parsed.medical_news) parsed.medical_news = [];
                if (!parsed.viral_titles) parsed.viral_titles = [];
                
                return parsed;
            } catch (jsonErr) {
                console.error("JSON Parse Error. Content:", jsonStr.substring(0, 150));
                
                // If it's short and fails, it's likely a text refusal like "I cannot..."
                if (jsonStr.length < 50 && !jsonStr.includes('{')) {
                    throw new Error(`Model Refusal: ${jsonStr}`);
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
                    await new Promise(r => setTimeout(r, waitTime));
                    return attempt(mId, retryCount + 1);
                }
                if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 0);
            }

            // If "response_format" is not supported by the provider, retry without it
            if (e.message.includes("'response_format'") || e.message.includes("400")) {
                 console.log("Retrying without response_format...");
                 // Recursive call with same model but we need a flag to avoid infinite loop. 
                 // For simplicity, just failover to fallback model which might be more standard.
                 if (mId === PRIMARY_MODEL) return attempt(FALLBACK_MODEL, 1);
            }

            if (retryCount === 0 && mId === PRIMARY_MODEL) {
                 return attempt(FALLBACK_MODEL, 1);
            }
            if (retryCount === 0 && mId === FALLBACK_MODEL) {
                 return attempt(SECONDARY_FALLBACK_MODEL, 1);
            }

            throw new Error(e.message || "Request failed.");
        }
    };

    return await attempt(userModelId);
};
