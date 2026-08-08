'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export type MoodState = 'fresh' | 'flow' | 'focused' | 'tired' | 'coffee' | 'celebrating' | 'standing' | 'night';

interface DevMoodCompanionProps {
  workMinutes?: number;
  commitsToday?: number;
  sessionsToday?: number;
  hour?: number;
  forceMood?: MoodState;
}

function deriveMood(
  workMinutes: number,
  commitsToday: number,
  sessionsToday: number,
  hour: number
): MoodState {
  if (commitsToday >= 10) return 'celebrating';
  if (workMinutes > 300) return 'tired';
  if (hour >= 12 && hour <= 16 && workMinutes > 60) return 'coffee';
  if (sessionsToday >= 2 && commitsToday >= 2) return 'flow';
  if ((hour >= 8 && hour <= 18) && (commitsToday > 0 || sessionsToday > 0)) return 'focused';
  if (hour >= 6 && hour <= 10) return 'fresh';
  if (hour >= 21 || hour <= 5) return 'night';
  return 'standing';
}

const ROASTS: Record<string, Record<MoodState, string[]>> = {
  zh: {
    fresh: ["键盘准备好了，脑子呢？", "早起的 Bug 有代码吃", "Coffee in, Garbage out.", "新的一天，先从摸鱼开始吧"],
    flow: ["我这一行下去，可能会死", "代码正在自动生成... 才怪", "我感觉我能重构宇宙！", "别碰我，我正处于超神状态"],
    focused: ["我是 10x 程序员（指 10 倍 Bug）", "编译中... 刚好够刷个视频", "此时一位路过的代码架构师发出了笑声", "正在用意念写代码"],
    tired: ["救命... 内存泄漏到我脑子里了", "正在尝试重启人类进程...", "我感觉我像个 node_modules 那么重", "Error: Brain Not Found."],
    coffee: ["感觉血液里全是咖啡因！", "我现在的频率可以干扰 Wi-Fi", "Java! Java! Java!", "这杯下去我能写出操作系统"],
    celebrating: ["我是代码之王！", "今晚不用修 Bug，直接全场买单！", "合并成功！给我也整一个披风", "没人能拒绝我的 PR"],
    standing: ["盯着我看干嘛？写代码去！", "等待指令中... (已睡着)", "我的摸鱼进度条已爆表", "我是你的代码监工，快干活"],
    night: ["凌晨三点，我是这条街最亮的 Bug", "只有月亮和编译器懂我", "写代码？不，我在修仙", "头发 -1, 经验 +0.01"],
  },
  en: {
    fresh: ["Keyboard ready, brain... not so much?", "The early bug gets the code.", "Coffee in, Garbage out.", "New day, let's start with some slacking."],
    flow: ["One more line and I'm done (lying).", "Code is auto-generating... Psych!", "I feel like I could refactor the universe!", "Don't touch me, I'm in god mode."],
    focused: ["I'm a 10x engineer (10x the bugs).", "Compiling... Just enough time for a YouTube video.", "A wild software architect appears!", "Coding via telepathy."],
    tired: ["Help... Memory leak in my brain.", "Attempting to restart human.exe...", "I feel as heavy as node_modules.", "Error: Brain Not Found."],
    coffee: ["My blood is 100% caffeine right now!", "My current frequency is interfering with Wi-Fi.", "Java! Java! Java!", "One more cup and I'll write an OS."],
    celebrating: ["I AM THE KING OF CODE!", "No bug fixing tonight, drinks on me!", "Merge successful! Where's my cape?", "Nobody rejects my PRs."],
    standing: ["Stop staring! Go write some code!", "Waiting for instructions... (fell asleep)", "My slacking progress bar is full.", "I'm your code supervisor, get back to work."],
    night: ["3 AM, I'm the brightest bug on the street.", "Only the moon and the compiler understand me.", "Coding? No, I'm ascending.", "Hair -1, XP +0.01."],
  }
};

const STATUS_TAGS: Record<string, Record<MoodState, string>> = {
  zh: {
    fresh: "正在加载人类意识",
    flow: "进入超空间",
    focused: "自动挡撸码中",
    tired: "离线挂机 (脑干缺失)",
    coffee: "严重超频 (心跳 200)",
    celebrating: "全场 MVP",
    standing: "观察人类写 Bug",
    night: "赛博修仙"
  },
  en: {
    fresh: "Loading Soul...",
    flow: "Hyperspace",
    focused: "Auto-coding",
    tired: "AFK (Brain Dead)",
    coffee: "Overclocked (Heart rate 200)",
    celebrating: "MVP of the Day",
    standing: "Watching Human Bugs",
    night: "Cyber-Ascension"
  }
};

export function getMood(
  workMinutes: number,
  commitsToday: number,
  sessionsToday: number,
  hour: number
): MoodState {
  return deriveMood(workMinutes, commitsToday, sessionsToday, hour);
}

export function getMoodColor(mood: MoodState, isAngry = false): string {
  if (isAngry) return '#F7768E';
  if (mood === 'night') return '#BB9AF7';
  if (mood === 'coffee') return '#73DACA';
  if (mood === 'tired') return '#E0AF68';
  return '#7AA2F7';
}

export function DevMoodCompanion({
  workMinutes = 0,
  commitsToday = 0,
  sessionsToday = 0,
  hour = new Date().getHours(),
  forceMood,
}: DevMoodCompanionProps) {
  const mood = forceMood ?? deriveMood(workMinutes, commitsToday, sessionsToday, hour);

  return (
    <div className="flex items-center">
      <StickmanMascot mood={mood} />
    </div>
  );
}

export function DevMoodStatusPanel({ mood, className = '' }: { mood: MoodState; className?: string }) {
  const { locale } = useTranslation();
  const lang = locale === 'zh' ? 'zh' : 'en';
  const color = getMoodColor(mood);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 justify-end">
        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
        <span className="text-[11px] font-bold tracking-tight uppercase" style={{ color }}>
          {STATUS_TAGS[lang][mood]}
        </span>
      </div>
      <div className="flex items-center gap-3 justify-end">
        <div className="h-1 w-24 bg-gray-800/50 rounded-full overflow-hidden border border-white/5">
          <div
            className="h-full transition-all duration-1000 ease-out"
            style={{
              width: mood === 'tired' ? '15%' : mood === 'coffee' ? '95%' : '60%',
              backgroundColor: color,
              boxShadow: `0 0 8px ${color}80`,
            }}
          />
        </div>
        <span className="text-[9px] font-mono text-gray-500 uppercase tracking-tighter">Sanity Level</span>
      </div>
    </div>
  );
}

function StickmanMascot({ mood }: { mood: MoodState }) {
  const { locale } = useTranslation();
  const lang = locale === 'zh' ? 'zh' : 'en';

  const [showBubble, setShowBubble] = useState(false);
  const [message, setMessage] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [isAngry] = useState(false);
  const [blink, setBlink] = useState(false);
  const [jitterOffset, setJitterOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const updateMessage = () => {
      if (isAngry) return;
      const pool = ROASTS[lang][mood];
      setMessage(pool[Math.floor(Math.random() * pool.length)]);
      setShowBubble(true);
      setTimeout(() => setShowBubble(false), 5000);
    };

    const interval = setInterval(updateMessage, 20000);
    updateMessage();
    return () => clearInterval(interval);
  }, [mood, isAngry, lang]);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    }, 3000 + Math.random() * 4000);
    return () => clearInterval(blinkInterval);
  }, []);

  useEffect(() => {
    if (mood === 'coffee') {
      const j = setInterval(() => {
        setJitterOffset({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 });
      }, 50);
      return () => clearInterval(j);
    }
  }, [mood]);

  const colors = {
    stroke: isAngry ? '#F7768E' : mood === 'night' ? '#BB9AF7' : mood === 'coffee' ? '#73DACA' : mood === 'tired' ? '#E0AF68' : '#7AA2F7',
    fill: isAngry ? '#F7768E20' : '#7AA2F715',
  };

  return (
    <div className="flex items-center">
      <div 
        className="relative w-20 h-16 transition-all duration-300"
        style={{ 
          transform: `translate(${jitterOffset.x}px, ${jitterOffset.y}px) scale(${isHovered ? 1.1 : 1})`,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 气泡 - 放在右侧，远离左侧边栏 */}
        <div
          className="absolute top-1/2 left-[110%] -translate-y-1/2 pointer-events-none z-[100]"
          style={{
            opacity: showBubble ? 1 : 0,
            transform: `translateY(-50%) translateX(${showBubble ? 0 : -10}px)`,
            transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          }}
        >
          <div className="bg-[#1a1b26] border-2 border-[currentColor] shadow-xl px-3 py-2 rounded-xl text-[10px] whitespace-nowrap text-white font-bold" style={{ color: colors.stroke }}>
            {message}
            {/* 尖角指向左侧 */}
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-[#1a1b26]" />
          </div>
        </div>

        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
          <Scenery mood={mood} stroke={colors.stroke} />
          <g 
            className={mood === 'celebrating' ? 'animate-bounce' : 'animate-[mascot-breathe_3s_ease-in-out_infinite]'} 
            style={{ transformOrigin: '60px 80px' }}
          >
            {mood === 'celebrating' && <path d="M50,50 L30,70 L35,45 Z" fill={colors.stroke} opacity="0.4" />}
            <path d="M45,25 Q45,10 60,12 Q75,10 75,25 Q75,40 60,38 Q45,40 45,25" stroke={colors.stroke} strokeWidth="3" fill={colors.fill} strokeLinecap="round" />
            <Eyes isHovered={isHovered} blink={blink} stroke={colors.stroke} />
            <Mouth isHovered={isHovered} stroke={colors.stroke} />
            <path d={mood === 'tired' ? "M60,45 Q70,55 75,75" : "M60,40 L60,70"} stroke={colors.stroke} strokeWidth="3" fill="none" strokeLinecap="round" />
            <Arm side="left" isHovered={isHovered} stroke={colors.stroke} />
            <Arm side="right" isHovered={isHovered} stroke={colors.stroke} />
            <Leg side="left" mood={mood} stroke={colors.stroke} />
            <Leg side="right" mood={mood} stroke={colors.stroke} />
          </g>
        </svg>
      </div>

      <style jsx global>{`
        @keyframes mascot-breathe {
          0%, 100% { transform: scale(1) rotate(0); }
          50% { transform: scaleY(0.95) scaleX(1.05) translateY(2px) rotate(1deg); }
        }
        @keyframes mascot-wiggle {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }
      `}</style>
    </div>
  );
}

function Scenery({ mood, stroke }: { mood: MoodState; stroke: string }) {
  if (mood === 'flow' || mood === 'focused') {
    return (
      <g stroke={stroke} fill="none" strokeWidth="2" strokeLinecap="round">
        <path d="M85,75 L110,75 L105,85 L90,85 Z" />
        <path d="M92,75 L92,62 L106,62 L106,75" />
        <circle cx="99" cy="68" r="1" fill={stroke} className="animate-pulse" />
      </g>
    );
  }
  if (mood === 'tired') {
    return (
      <g stroke={stroke} fill="none" strokeWidth="1.5" strokeLinecap="round">
        <path d="M30,85 Q40,80 50,85 Q60,90 70,85" />
        <path d="M35,80 L40,75" /><path d="M65,82 L70,78" />
      </g>
    );
  }
  if (mood === 'night') {
    return (
      <g stroke={stroke} fill="none" strokeWidth="1.5">
        <path d="M60,0 L60,12" strokeDasharray="2,2" />
        <path d="M50,12 L70,12 L60,8 Z" fill={stroke} opacity="0.3" />
        <circle cx="60" cy="15" r="1.5" fill={stroke} className="animate-pulse" />
      </g>
    );
  }
  return null;
}

function Eyes({ isHovered, blink, stroke }: { isHovered: boolean; blink: boolean; stroke: string }) {
  if (blink) return <g stroke={stroke} strokeWidth="2"><path d="M53,25 L58,25" /><path d="M62,25 L67,25" /></g>;
  return <g fill={stroke}><circle cx="55" cy="25" r={isHovered ? 3 : 2} /><circle cx="65" cy="25" r={isHovered ? 3 : 2} /></g>;
}

function Mouth({ isHovered, stroke }: { isHovered: boolean; stroke: string }) {
  if (isHovered) return <circle cx="60" cy="32" r="3" fill="none" stroke={stroke} strokeWidth="2" />;
  return <path d="M55,32 Q60,34 65,32" stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" />;
}

function Arm({ side, isHovered, stroke }: { side: 'left' | 'right', isHovered: boolean, stroke: string }) {
  const isLeft = side === 'left';
  let d = isLeft ? "M60,45 Q50,50 45,60" : "M60,45 Q70,50 75,60";
  if (isHovered && !isLeft) d = "M60,45 Q80,40 95,25";
  return <path d={d} stroke={stroke} strokeWidth="2.5" fill="none" strokeLinecap="round" style={{ transformOrigin: '60px 45px' }} className={isHovered && !isLeft ? 'animate-[mascot-wiggle_0.5s_ease-in-out_infinite]' : ''} />;
}

function Leg({ side, mood, stroke }: { side: 'left' | 'right', mood: MoodState, stroke: string }) {
  const isLeft = side === 'left';
  let d = isLeft ? "M60,70 Q55,80 50,90" : "M60,70 Q65,80 70,90";
  if (mood === 'tired') d = isLeft ? "M60,70 Q70,80 80,85" : "M60,70 Q75,85 90,88";
  return <path d={d} stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round" />;
}

// Demo
export function DevMoodCompanionDemo() {
  const moods: MoodState[] = ['fresh', 'flow', 'focused', 'tired', 'coffee', 'celebrating', 'standing', 'night'];

  return (
    <div className="p-10 bg-[#1a1b26] rounded-2xl border border-white/10 shadow-2xl">
      <h3 className="text-xl font-bold mb-6 text-white text-center">场景化火柴人 3.1</h3>
      <div className="grid grid-cols-2 gap-16">
        {moods.map((mood) => (
          <div key={mood} className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white/5 border border-transparent hover:border-[#7AA2F7]/50 group transition-all">
            <DevMoodCompanion forceMood={mood} />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 group-hover:text-[#7AA2F7] mt-4">{mood}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
