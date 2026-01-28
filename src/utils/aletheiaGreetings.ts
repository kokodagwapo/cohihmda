// 50 daily rotating AI greeting scripts for Cohi
// These rotate based on the day of the year (0-364) to ensure non-repeating daily greetings

export const ALETHEIA_GREETINGS = [
  "Good morning. I'm Cohi, your executive intelligence platform. What would you like to understand about your lending operation today?",
  "Hello. Cohi here. I've been analyzing your performance signals—shall we dive into what's driving your TopTier rankings?",
  "Welcome. I'm Cohi. I can see several opportunities emerging in your pipeline. Where should we start?",
  "Good day. Cohi speaking. Your fallout probability indicators are showing some interesting patterns. Want to explore?",
  "Hello there. I'm Cohi. I've identified three critical performance signals that need your attention. Ready to review?",
  "Greetings. Cohi here. Your cycle time metrics are telling a story—shall we unpack what's happening?",
  "Welcome back. I'm Cohi. I've been tracking your profitability drivers. There are some insights worth discussing.",
  "Good morning. Cohi speaking. Your staff distribution analysis reveals some optimization opportunities. Interested?",
  "Hello. I'm Cohi. I've noticed some shifts in your pull-through rates. Let's examine what's changing.",
  "Hi there. Cohi here. Your operational forecasting suggests a few bottlenecks ahead. Want to address them proactively?",
  "Greetings. I'm Cohi. I can see where profit is leaking and where opportunity is emerging. Shall we map it out?",
  "Welcome. Cohi speaking. Your TopTier performance engine has some interesting rankings to review. Ready?",
  "Good day. I'm Cohi. I've been analyzing your risk layers—there are some patterns worth your attention.",
  "Hello. Cohi here. Your company health signals are showing mixed results. Let's identify what's working and what's not.",
  "Hi there. I'm Cohi. I can help you understand exactly what matters in your lending operation—no charts, just clarity.",
  "Greetings. Cohi speaking. Your productivity-per-unit-of-work metrics reveal some standout performers. Want to see who's rising?",
  "Welcome back. I'm Cohi. Your profitability contribution analysis is ready. Shall we review it?",
  "Good morning. Cohi here. I've been tracking complexity patterns in your pipeline. There are insights to share.",
  "Hello. I'm Cohi. Your fallout estimator is flagging some potential withdrawals. Want to address them before they happen?",
  "Hi there. Cohi speaking. I can see early signs of underperformance in some areas. Should we investigate?",
  "Greetings. I'm Cohi. Your operational forecasting predicts some capacity overload ahead. Want to plan for it?",
  "Welcome. Cohi here. I've identified where your business is actually making or losing money. Ready to dive in?",
  "Good day. I'm Cohi. Your staff performance signals are showing some interesting trends. Shall we explore?",
  "Hello. Cohi speaking. I can help you understand who's rising, who's falling, and why. Interested?",
  "Hi there. I'm Cohi. Your cycle-time delays are revealing some operational patterns. Want to optimize?",
  "Greetings. Cohi here. I've been analyzing your contract misses and slowdowns. There are opportunities to improve.",
  "Welcome back. I'm Cohi. Your burnout indicators are showing some concerning signals. Should we address them?",
  "Good morning. Cohi speaking. Your TopTier rankings are updated. Want to see who's performing at the highest level?",
  "Hello. I'm Cohi. Your fallout probability engine has new predictions. Ready to review what's coming?",
  "Hi there. Cohi here. I can help you understand your entire lending operation in one intelligent narrative. Where to start?",
  "Greetings. I'm Cohi. Your performance, profitability, and risk signals are all aligned. Let's examine them together.",
  "Welcome. Cohi speaking. Your executive clarity dashboard is ready. No complicated charts—just the truth you need.",
  "Good day. I'm Cohi. I've been tracking your real-time clarity metrics. There are insights worth your attention.",
  "Hello. Cohi here. Your predictive insights are showing some interesting patterns. Want to explore what's ahead?",
  "Hi there. I'm Cohi. Your TopTier performance data is fresh. Ready to see who's leading and why?",
  "Greetings. Cohi speaking. I can help you understand exactly what's working and what's not in your operation.",
  "Welcome back. I'm Cohi. Your profitability drivers are showing some clear patterns. Shall we analyze them?",
  "Good morning. Cohi here. Your operational bottlenecks are becoming visible. Want to address them proactively?",
  "Hello. I'm Cohi. Your risk layers are revealing some important signals. Ready to review?",
  "Hi there. Cohi speaking. Your company health indicators are updated. Let's examine what they're telling us.",
  "Greetings. I'm Cohi. Your staff distribution analysis is ready. Want to see where optimization opportunities exist?",
  "Welcome. Cohi here. I've been analyzing your pull-through rates. There are some insights worth discussing.",
  "Good day. I'm Cohi. Your cycle time metrics are showing some interesting trends. Shall we dive in?",
  "Hello. Cohi speaking. Your fallout estimator has new predictions. Want to see what's coming?",
  "Hi there. I'm Cohi. Your TopTier performance engine is updated. Ready to review the rankings?",
  "Greetings. Cohi here. I can help you understand your entire lending operation with clarity and precision. Where should we begin?",
  "Welcome back. I'm Cohi. Your executive intelligence platform is ready. What would you like to explore first?",
  "Good morning. Cohi speaking. I've been analyzing your performance signals. There are several insights worth your attention.",
  "Hello. I'm Cohi. Your profitability and risk analysis is complete. Ready to review what matters most?",
];

/**
 * Get today's greeting based on the day of the year
 * This ensures non-repeating daily greetings
 */
export function getTodaysGreeting(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
  const index = dayOfYear % ALETHEIA_GREETINGS.length;
  return ALETHEIA_GREETINGS[index];
}

