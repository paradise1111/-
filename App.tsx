import React, { useState, useEffect, useRef } from 'react';
import { Activity, Globe, HeartPulse, RefreshCw, Server, ShieldCheck, Sparkles, Mail, Clock, Send, Stethoscope, AlertTriangle, Settings } from 'lucide-react';
import { GlassCard } from './components/GlassCard';
import { StatusBadge } from './components/StatusBadge';
import { TypewriterText } from './components/TypewriterText';
import { SettingsModal } from './components/SettingsModal';
import { checkConnectivity, generateBriefing, PRIMARY_MODEL } from './services/geminiService';
import { sendEmail } from './services/emailService';
import { AppStatus, GeneratedContent, NewsItem, UserConfig } from './types';

interface NewsCardProps {
  item: NewsItem;
  idx: number;
  color: 'blue' | 'emerald';
}

const NewsCard: React.FC<NewsCardProps> = ({ item, idx, color }) => (
  <GlassCard className="h-full flex flex-col" delay={idx * 100}>
    <div className="flex justify-between items-start mb-3">
      <span className={`text-xs font-mono px-2 py-1 rounded border ${color === 'blue' ? 'border-blue-500/30 text-blue-300' : 'border-emerald-500/30 text-emerald-300'}`}>
        {item.source_name || 'Source'}
      </span>
      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors">
        <Globe size={14} />
      </a>
    </div>
    <h3 className="text-lg font-medium text-white mb-1 leading-snug">{item.title_cn}</h3>
    <p className="text-xs text-gray-500 mb-3 font-light">{item.title_en}</p>
    <p className="text-sm text-gray-300 leading-relaxed flex-grow">{item.summary_cn}</p>
  </GlassCard>
);

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [data, setData] = useState<GeneratedContent | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [lastAutoRunDate, setLastAutoRunDate] = useState<string>("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userConfig, setUserConfig] = useState<UserConfig>({});
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

  // Load config from localStorage
  useEffect(() => {
    const savedConfig = localStorage.getItem('aurora_config');
    if (savedConfig) {
      try {
        setUserConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error("Failed to parse saved config", e);
      }
    }
  }, []);

  const handleSaveConfig = (newConfig: UserConfig) => {
    setUserConfig(newConfig);
    localStorage.setItem('aurora_config', JSON.stringify(newConfig));
    addLog("配置已更新。正在重新建立连接...");
    // 重新触发连接检查
    initConnection(newConfig);
  };

  const initConnection = async (config: UserConfig) => {
    setStatus(AppStatus.CONNECTING);
    const modelName = config.modelId || PRIMARY_MODEL;
    addLog(`正在初始化与 AI 网关的连接... 目标模型: ${modelName}`);
    if (config.baseUrl) {
        addLog(`使用自定义网关: ${config.baseUrl}`);
    }
    
    const isConnected = await checkConnectivity(config);
    if (isConnected) {
      setStatus(AppStatus.IDLE);
      addLog(`握手成功。通信链路正常。当前节点: ${modelName}`);
    } else {
      setStatus(AppStatus.ERROR);
      addLog(`严重错误: 无法连接至模型 ${modelName}。请检查 API Key / Base URL 设置。`);
    }
  };

  useEffect(() => {
    // Initial Connectivity Check
    initConnection(userConfig);
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
    
    const currentModel = userConfig.modelId || PRIMARY_MODEL;

    try {
      addLog("正在调用 Search Tool 进行链接验证...");
      await new Promise(r => setTimeout(r, 800)); 
      addLog("正在从全球源检索索引...");
      
      setStatus(AppStatus.GENERATING);
      addLog(`正在使用 ${currentModel} 合成双语内容...`);
      
      const result = await generateBriefing(targetDateStr, userConfig);
      
      setData(result);
      setStatus(AppStatus.COMPLETED);
      addLog("序列完成。内容已准备就绪。");

      if (isAutoRun) {
        await executeEmailSend(result, true);
      }

    } catch (e: any) {
      console.error(e);
      setStatus(AppStatus.ERROR);
      
      // 用户友好的错误解析
      let errorMsg = e.message || "未知错误";
      if (errorMsg.includes("API key not valid") || errorMsg.includes("400")) {
        errorMsg = "API Key 无效 (400)。请检查设置中的 API Key。";
      } else if (errorMsg.includes("API_KEY is missing")) {
        errorMsg = "未配置 API Key。请在设置中输入 Key 或在服务器配置。";
      }

      addLog(`❌ 生成过程中出错: ${errorMsg}`);
    }
  };

  const executeEmailSend = async (content: GeneratedContent | null, isAuto: boolean) => {
    const activeEmails = emails.filter(e => e.trim() !== '');
    if (activeEmails.length === 0) {
      addLog(isAuto ? "⚠️ 自动任务完成，但未配置接收邮箱。" : "⚠️ 请先输入有效的邮箱地址");
      return;
    }
    
    if (!content) {
        addLog("⚠️ 无内容可发送。请先生成简报。");
        return;
    }

    addLog(`📧 ${isAuto ? '自动' : '手动'}推送：正在发送邮件至 ${activeEmails.length} 个地址...`);
    setIsSendingEmail(true);
    
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

  return (
    <div className="min-h-screen relative text-gray-200 selection:bg-indigo-500/30">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveConfig}
        initialConfig={userConfig}
      />

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
            
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
            >
              <Settings className="w-5 h-5 text-gray-300" />
            </button>
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
                     <span className="text-emerald-400 font-mono text-xs truncate max-w-[150px] text-right" title={userConfig.modelId || PRIMARY_MODEL}>
                       {userConfig.modelId || PRIMARY_MODEL}
                     </span>
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
                    : 'bg-white text-black hover:bg-gray-100'
                  }`}
                >
                  {status === AppStatus.SEARCHING || status === AppStatus.GENERATING ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Start Generation Sequence</span>
                    </>
                  )}
                </button>
              </div>
            </GlassCard>

            {/* Terminal / Log */}
            <GlassCard className="h-[250px] flex flex-col">
              <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-gray-400">System Log</span>
              </div>
              <div 
                ref={scrollRef}
                className="flex-grow overflow-y-auto font-mono text-xs space-y-2 pr-2 text-gray-400"
              >
                {progressLog.length === 0 && <span className="opacity-30">Waiting for commands...</span>}
                {progressLog.map((log, i) => (
                  <div key={i} className="border-l-2 border-white/10 pl-2 py-0.5 animate-scanline">
                    <span className="text-blue-500 mr-2">$</span>
                    {log}
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Email Config */}
             <GlassCard className="space-y-4">
              <div className="flex items-center gap-2 text-white font-medium">
                <Mail className="w-4 h-4 text-purple-400" />
                <span>自动推送设置</span>
              </div>
              <div className="space-y-2">
                {emails.map((email, idx) => (
                  <input
                    key={idx}
                    type="email"
                    placeholder={`Recipient ${idx + 1}`}
                    value={email}
                    onChange={(e) => handleEmailChange(idx, e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50 transition-colors"
                  />
                ))}
              </div>
              <button 
                onClick={() => executeEmailSend(data, false)}
                disabled={isSendingEmail || !data}
                className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-gray-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSendingEmail ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Send className="w-3 h-3" />}
                Send Manual Test
              </button>
            </GlassCard>

          </div>

          {/* Right Column: Content */}
          <div className="lg:col-span-8 space-y-6">
            {!data ? (
              <GlassCard className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12">
                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 relative">
                  <div className="absolute inset-0 rounded-full border border-white/10 animate-ping opacity-20"></div>
                  <Globe className="w-10 h-10 text-gray-500" />
                </div>
                <h3 className="text-xl font-light text-white mb-2">Ready to Synchronize</h3>
                <p className="text-gray-500 max-w-md">
                  Waiting for retrieval command. System will verify links, translate content, and generate viral headers using Gemini 1.5 Pro.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-6 animate-scanline">
                
                {/* Viral Headers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* General Viral */}
                  <GlassCard className="bg-gradient-to-br from-pink-500/10 to-transparent border-pink-500/20">
                    <h3 className="text-pink-400 font-bold mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Global Viral
                    </h3>
                    <ul className="space-y-2">
                      {data.viral_titles.map((t, i) => (
                        <li key={i} className="text-sm text-gray-200 border-l-2 border-pink-500/30 pl-3 py-1">
                          <TypewriterText text={t} speed={20} />
                        </li>
                      ))}
                    </ul>
                  </GlassCard>

                  {/* Medical Viral */}
                  <GlassCard className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
                    <h3 className="text-emerald-400 font-bold mb-3 flex items-center gap-2">
                      <Stethoscope className="w-4 h-4" />
                      Health Viral
                    </h3>
                    <ul className="space-y-2">
                      {data.medical_viral_titles?.map((t, i) => (
                        <li key={i} className="text-sm text-gray-200 border-l-2 border-emerald-500/30 pl-3 py-1">
                          <TypewriterText text={t} speed={20} />
                        </li>
                      )) || <li className="text-gray-500 text-sm italic">No viral health topics today.</li>}
                    </ul>
                  </GlassCard>
                </div>

                {/* News Sections */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl text-blue-400 font-light mb-4 flex items-center gap-2">
                      <Globe className="w-5 h-5" /> Global Affairs
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {data.general_news.map((item, i) => (
                        <NewsCard key={i} item={item} idx={i} color="blue" />
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xl text-emerald-400 font-light mb-4 flex items-center gap-2">
                      <HeartPulse className="w-5 h-5" /> Medical & Science
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {data.medical_news.map((item, i) => (
                        <NewsCard key={i} item={item} idx={i} color="emerald" />
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
