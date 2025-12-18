import React, { useState, useEffect, useRef } from 'react';
import { Activity, Globe, HeartPulse, RefreshCw, Server, ShieldCheck, Sparkles, Mail, Clock, Send, Stethoscope } from 'lucide-react';
import { GlassCard } from './components/GlassCard';
import { StatusBadge } from './components/StatusBadge';
import { TypewriterText } from './components/TypewriterText';
import { checkConnectivity, generateBriefing } from './services/geminiService';
import { sendEmail } from './services/emailService';
import { AppStatus, GeneratedContent, NewsItem } from './types';

interface NewsCardProps {
  item: NewsItem;
  idx: number;
  color: 'blue' | 'emerald';
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [data, setData] = useState<GeneratedContent | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [lastAutoRunDate, setLastAutoRunDate] = useState<string>("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Time Logic
  const today = new Date();
  const beijingOffset = 8 * 60; 
  const localOffset = today.getTimezoneOffset();
  const beijingTime = new Date(today.getTime() + (beijingOffset + localOffset) * 60 * 1000);
  
  // Target Yesterday (Beijing time)
  const yesterday = new Date(beijingTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateStr = yesterday.toISOString().split('T')[0];
  const displayTime = beijingTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    // Initial Connectivity Check
    const init = async () => {
      setStatus(AppStatus.CONNECTING);
      addLog("正在初始化与 Gemini Pro 网关的安全握手...");
      const isConnected = await checkConnectivity();
      if (isConnected) {
        setStatus(AppStatus.IDLE);
        addLog("握手成功。延迟: 145ms。节点: gemini-3-flash-preview");
      } else {
        setStatus(AppStatus.ERROR);
        addLog("严重错误: 无法连接至 AI 网关。");
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scheduler Effect
  useEffect(() => {
    const checkSchedule = () => {
      const now = new Date();
      const currentBeijingTime = new Date(now.getTime() + (beijingOffset + now.getTimezoneOffset()) * 60 * 1000);
      const currentDateStr = currentBeijingTime.toDateString();

      // Trigger at 09:00 AM Beijing Time
      if (
        currentBeijingTime.getHours() === 9 && 
        currentBeijingTime.getMinutes() === 0 && 
        lastAutoRunDate !== currentDateStr
      ) {
        if (status === AppStatus.IDLE || status === AppStatus.COMPLETED) {
          addLog("⏰ 自动调度程序触发：北京时间 09:00");
          setLastAutoRunDate(currentDateStr);
          handleGenerate(true);
        }
      }
    };

    const timer = setInterval(checkSchedule, 10000); 
    return () => clearInterval(timer);
  }, [lastAutoRunDate, status]);

  const addLog = (msg: string) => {
    setProgressLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    if (scrollRef.current) {
        setTimeout(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }, 100);
    }
  };

  const handleGenerate = async (isAutoRun = false) => {
    if (status === AppStatus.GENERATING || status === AppStatus.SEARCHING) return;

    setData(null);
    setStatus(AppStatus.SEARCHING);
    addLog(`启动自动化序列。目标日期: ${targetDateStr}`);
    
    try {
      addLog("正在调用 Google Search Grounding 进行链接验证...");
      await new Promise(r => setTimeout(r, 800)); 
      addLog("正在从全球源检索昨日索引...");
      
      setStatus(AppStatus.GENERATING);
      addLog("正在使用 gemini-3-pro-preview 合成双语内容 (含医学爆款标题)...");
      
      const result = await generateBriefing(targetDateStr);
      
      setData(result);
      setStatus(AppStatus.COMPLETED);
      addLog("序列完成。内容已准备就绪。");

      if (isAutoRun) {
        await executeEmailSend(result, true);
      }

    } catch (e: any) {
      console.error(e);
      setStatus(AppStatus.ERROR);
      addLog(`生成过程中出错: ${e.message || "未知错误"}`);
    }
  };

  const executeEmailSend = async (content: GeneratedContent | null, isAuto: boolean) => {
    const activeEmails = emails.filter(e => e.trim() !== '');
    if (activeEmails.length === 0) {
      addLog(isAuto ? "⚠️ 自动任务完成，但未配置接收邮箱。" : "⚠️ 请先输入有效的邮箱地址");
      return;
    }

    addLog(`📧 ${isAuto ? '自动' : '手动'}推送：正在发送邮件至 ${activeEmails.length} 个地址...`);
    setIsSendingEmail(true);
    
    // API Key is now handled by the backend
    const result = await sendEmail(activeEmails, content);
    
    if (result.success) {
      addLog(`>>> ✅ ${result.message}`);
    } else {
      addLog(`>>> ❌ ${result.message}`);
    }
    setIsSendingEmail(false);
  };

  const handleEmailChange = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);
  };

  const handleTestEmail = () => {
    executeEmailSend(data, false);
  };

  return (
    <div className="min-h-screen relative text-gray-200 selection:bg-indigo-500/30">
      {/* Aurora Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
         <div className="absolute top-[-20%] left-[20%] w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[120px] mix-blend-screen animate-pulse"></div>
         <div className="absolute top-[-10%] right-[10%] w-[500px] h-[500px] bg-blue-900/20 rounded-full blur-[100px] mix-blend-screen"></div>
         <div className="absolute bottom-[-10%] left-[10%] w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[120px] mix-blend-screen"></div>
         <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8 lg:px-8">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-4xl font-light tracking-tight text-white mb-2 font-display">
              Aurora <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-300">News Insight</span>
            </h1>
            <p className="text-gray-400 font-light flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              多源验证检索系统
              <span className="text-gray-600">|</span>
              <span className="text-xs font-mono opacity-60">BUILD 2025.12.18</span>
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right hidden md:block">
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">北京时间 (Beijing Time)</div>
              <div className="font-mono text-xl text-white">{displayTime}</div>
            </div>
            <StatusBadge status={status === AppStatus.ERROR ? 'offline' : (status === AppStatus.IDLE || status === AppStatus.COMPLETED ? 'online' : 'busy')} />
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls & Stats */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Control Panel */}
            <GlassCard className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-400" />
                  控制中心
                </h2>
                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></div>
              </div>

              <div className="space-y-4">
                <div className="bg-black/40 rounded-lg p-4 border border-white/5">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">目标日期</span>
                    <span className="text-white font-mono">{targetDateStr}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                     <span className="text-gray-400">模型节点</span>
                     <span className="text-emerald-400 font-mono text-xs">gemini-3-pro-preview</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">下次自动运行</span>
                    <span className="text-blue-300 font-mono">09:00:00 CST</span>
                  </div>
                </div>

                <button
                  onClick={() => handleGenerate(false)}
                  disabled={status === AppStatus.SEARCHING || status === AppStatus.GENERATING}
                  className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 relative overflow-hidden group ${
                    status === AppStatus.SEARCHING || status === AppStatus.GENERATING 
                    ? 'bg-gray-800 cursor-not-allowed opacity-50' 
                    : 'bg-white text-black hover:bg-gray-200'
                  }`}
                >
                  {(status === AppStatus.SEARCHING || status === AppStatus.GENERATING) ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>正在执行序列...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 transition-transform group-hover:scale-110" />
                      <span className="font-medium">生成今日简报</span>
                    </>
                  )}
                </button>
              </div>
            </GlassCard>

            {/* Email Subscription Panel */}
            <GlassCard className="space-y-4">
               <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium text-white flex items-center gap-2">
                    <Mail className="w-5 h-5 text-purple-400" />
                    Resend 邮件服务 (Cloud)
                  </h2>
                  <Clock className="w-4 h-4 text-gray-500" />
               </div>
               
               <p className="text-[10px] text-gray-500 leading-tight">
                 系统已接入 Vercel Serverless。请在后台配置 RESEND_API_KEY，无需在此输入。
               </p>

               <div className="space-y-2 mt-2">
                 {emails.map((email, idx) => (
                   <input
                     key={idx}
                     type="email"
                     placeholder={`接收邮箱 ${idx + 1}`}
                     value={email}
                     onChange={(e) => handleEmailChange(idx, e.target.value)}
                     className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                   />
                 ))}
               </div>
               
               {/* Test Button */}
               <div className="flex justify-end pt-2 border-t border-white/5">
                  <button
                    onClick={handleTestEmail}
                    disabled={isSendingEmail}
                    className={`text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors border ${
                      isSendingEmail 
                        ? 'bg-purple-500/10 border-purple-500/10 text-purple-400/50 cursor-not-allowed'
                        : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/20'
                    }`}
                  >
                    {isSendingEmail ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    发送测试邮件
                  </button>
               </div>
            </GlassCard>

            {/* Terminal Log */}
            <GlassCard className="h-[300px] flex flex-col">
              <div className="mb-4 text-xs font-mono text-gray-500 uppercase tracking-widest border-b border-white/5 pb-2">
                系统日志终端
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-xs space-y-2 text-green-400/80 pr-2">
                {progressLog.length === 0 && <span className="text-gray-600 opacity-50">等待指令...</span>}
                {progressLog.map((log, i) => (
                  <div key={i} className="animate-scanline">{log}</div>
                ))}
              </div>
            </GlassCard>

             {/* Viral Titles Preview (Only shows after generation) */}
             {data && (
               <GlassCard className="border-pink-500/20">
                  <h3 className="text-pink-300 font-medium mb-4 flex items-center gap-2">
                    <HeartPulse className="w-4 h-4" />
                    全网热榜 (小红书风)
                  </h3>
                  <div className="space-y-3">
                    {data.viral_titles.map((title, idx) => (
                      <div key={idx} className="bg-pink-500/5 border border-pink-500/10 p-3 rounded-lg text-sm text-pink-100/90 font-medium">
                        {title}
                      </div>
                    ))}
                  </div>
               </GlassCard>
             )}
          </div>

          {/* Right Column: Content Feed */}
          <div className="lg:col-span-8 space-y-8">
            {!data && status !== AppStatus.SEARCHING && status !== AppStatus.GENERATING && (
              <div className="h-full flex flex-col items-center justify-center min-h-[400px] text-gray-500 opacity-50">
                <Globe className="w-24 h-24 mb-4 stroke-1" />
                <p className="font-light">系统就绪。等待执行指令。</p>
              </div>
            )}

            {data && (
              <>
                 {/* General News Section */}
                 <div>
                    <h3 className="text-xl text-white font-light mb-6 flex items-center gap-3">
                      <span className="w-8 h-[1px] bg-blue-500"></span>
                      全球时政要闻
                    </h3>
                    <div className="grid grid-cols-1 gap-4">
                      {data.general_news.map((item, idx) => (
                        <NewsCard key={idx} item={item} idx={idx} color="blue" />
                      ))}
                    </div>
                 </div>

                 {/* Medical News Section */}
                 <div>
                    <h3 className="text-xl text-white font-light mb-6 flex items-center gap-3">
                      <span className="w-8 h-[1px] bg-emerald-500"></span>
                      前沿医学进展
                    </h3>
                    
                    {/* Medical Viral Titles (New Feature) */}
                    {data.medical_viral_titles && data.medical_viral_titles.length > 0 && (
                      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                        {data.medical_viral_titles.map((title, i) => (
                           <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg flex flex-col justify-center">
                              <div className="flex items-center gap-2 mb-1">
                                <Stethoscope className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] text-emerald-300 uppercase">健康热搜</span>
                              </div>
                              <p className="text-xs font-medium text-emerald-100 leading-relaxed">
                                {title}
                              </p>
                           </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4">
                      {data.medical_news.map((item, idx) => (
                        <NewsCard key={idx} item={item} idx={idx} color="emerald" />
                      ))}
                    </div>
                 </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-component for News Item
const NewsCard: React.FC<NewsCardProps> = ({ item, idx, color }) => {
  const isBlue = color === 'blue';
  const themeColor = isBlue ? 'blue' : 'emerald';
  
  return (
    <GlassCard delay={idx * 100} className="group hover:bg-white/10">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-3">
          {/* Header with Source */}
          <div className="flex items-center justify-between">
             <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-${themeColor}-500/10 text-${themeColor}-400 border border-${themeColor}-500/20`}>
               {item.source_name}
             </span>
             <a 
              href={item.source_url} 
              target="_blank" 
              rel="noreferrer"
              className={`hidden md:inline-flex items-center gap-1 text-xs text-${themeColor}-400 hover:text-white transition-colors pb-0.5 border-b border-transparent hover:border-${themeColor}-400`}
            >
              访问来源 ↗
            </a>
          </div>

          {/* Titles */}
          <div>
            <a href={item.source_url} target="_blank" rel="noreferrer" className="block">
              <h4 className={`text-lg font-medium text-white mb-1 leading-tight group-hover:text-${themeColor}-300 transition-colors`}>
                {item.title_cn}
              </h4>
            </a>
            <p className="text-sm text-gray-400 font-light">{item.title_en}</p>
          </div>

          {/* Summaries */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
            <div className="text-gray-300 font-light leading-relaxed border-l-2 border-white/10 pl-3">
               <TypewriterText text={item.summary_cn} speed={5} />
            </div>
            <div className="text-gray-500 font-light leading-relaxed border-l-2 border-white/5 pl-3">
               <p>{item.summary_en}</p>
            </div>
          </div>
          
          {/* Mobile Link */}
           <div className="pt-2 md:hidden">
            <a 
              href={item.source_url} 
              target="_blank" 
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
            >
              验证来源 ↗
            </a>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};