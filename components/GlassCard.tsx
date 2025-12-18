import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number; // Animation delay
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', delay = 0 }) => {
  const style = delay > 0 ? { animationDelay: `${delay}ms` } : {};
  
  return (
    <div 
      className={`glass-panel rounded-2xl p-6 relative overflow-hidden transition-all duration-300 hover:bg-white/5 ${className}`}
      style={style}
    >
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-50"></div>
      <div className="absolute bottom-0 right-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-30"></div>
      {children}
    </div>
  );
};