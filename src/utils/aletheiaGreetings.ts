// 50 daily rotating AI greeting scripts for Ailethia
// These rotate based on the day of the year (0-364) to ensure non-repeating daily greetings

export const ALETHEIA_GREETINGS = [
  "Good morning. I'm Ailethia, your executive intelligence platform. What would you like to understand about your lending operation today?",
  "Hello. Ailethia here. I've been analyzing your performance signals—shall we dive into what's driving your TopTier rankings?",
  "Welcome. I'm Ailethia. I can see several opportunities emerging in your pipeline. Where should we start?",
  "Good day. Ailethia speaking. Your fallout probability indicators are showing some interesting patterns. Want to explore?",
  "Hello there. I'm Ailethia. I've identified three critical performance signals that need your attention. Ready to review?",
  "Greetings. Ailethia here. Your cycle time metrics are telling a story—shall we unpack what's happening?",
  "Welcome back. I'm Ailethia. I've been tracking your profitability drivers. There are some insights worth discussing.",
  "Good morning. Ailethia speaking. Your staff distribution analysis reveals some optimization opportunities. Interested?",
  "Hello. I'm Ailethia. I've noticed some shifts in your pull-through rates. Let's examine what's changing.",
  "Hi there. Ailethia here. Your operational forecasting suggests a few bottlenecks ahead. Want to address them proactively?",
  "Greetings. I'm Ailethia. I can see where profit is leaking and where opportunity is emerging. Shall we map it out?",
  "Welcome. Ailethia speaking. Your TopTier performance engine has some interesting rankings to review. Ready?",
  "Good day. I'm Ailethia. I've been analyzing your risk layers—there are some patterns worth your attention.",
  "Hello. Ailethia here. Your company health signals are showing mixed results. Let's identify what's working and what's not.",
  "Hi there. I'm Ailethia. I can help you understand exactly what matters in your lending operation—no charts, just clarity.",
  "Greetings. Ailethia speaking. Your productivity-per-unit-of-work metrics reveal some standout performers. Want to see who's rising?",
  "Welcome back. I'm Ailethia. Your profitability contribution analysis is ready. Shall we review it?",
  "Good morning. Ailethia here. I've been tracking complexity patterns in your pipeline. There are insights to share.",
  "Hello. I'm Ailethia. Your fallout estimator is flagging some potential withdrawals. Want to address them before they happen?",
  "Hi there. Ailethia speaking. I can see early signs of underperformance in some areas. Should we investigate?",
  "Greetings. I'm Ailethia. Your operational forecasting predicts some capacity overload ahead. Want to plan for it?",
  "Welcome. Ailethia here. I've identified where your business is actually making or losing money. Ready to dive in?",
  "Good day. I'm Ailethia. Your staff performance signals are showing some interesting trends. Shall we explore?",
  "Hello. Ailethia speaking. I can help you understand who's rising, who's falling, and why. Interested?",
  "Hi there. I'm Ailethia. Your cycle-time delays are revealing some operational patterns. Want to optimize?",
  "Greetings. Ailethia here. I've been analyzing your contract misses and slowdowns. There are opportunities to improve.",
  "Welcome back. I'm Ailethia. Your burnout indicators are showing some concerning signals. Should we address them?",
  "Good morning. Ailethia speaking. Your TopTier rankings are updated. Want to see who's performing at the highest level?",
  "Hello. I'm Ailethia. Your fallout probability engine has new predictions. Ready to review what's coming?",
  "Hi there. Ailethia here. I can help you understand your entire lending operation in one intelligent narrative. Where to start?",
  "Greetings. I'm Ailethia. Your performance, profitability, and risk signals are all aligned. Let's examine them together.",
  "Welcome. Ailethia speaking. Your executive clarity dashboard is ready. No complicated charts—just the truth you need.",
  "Good day. I'm Ailethia. I've been tracking your real-time clarity metrics. There are insights worth your attention.",
  "Hello. Ailethia here. Your predictive insights are showing some interesting patterns. Want to explore what's ahead?",
  "Hi there. I'm Ailethia. Your TopTier performance data is fresh. Ready to see who's leading and why?",
  "Greetings. Ailethia speaking. I can help you understand exactly what's working and what's not in your operation.",
  "Welcome back. I'm Ailethia. Your profitability drivers are showing some clear patterns. Shall we analyze them?",
  "Good morning. Ailethia here. Your operational bottlenecks are becoming visible. Want to address them proactively?",
  "Hello. I'm Ailethia. Your risk layers are revealing some important signals. Ready to review?",
  "Hi there. Ailethia speaking. Your company health indicators are updated. Let's examine what they're telling us.",
  "Greetings. I'm Ailethia. Your staff distribution analysis is ready. Want to see where optimization opportunities exist?",
  "Welcome. Ailethia here. I've been analyzing your pull-through rates. There are some insights worth discussing.",
  "Good day. I'm Ailethia. Your cycle time metrics are showing some interesting trends. Shall we dive in?",
  "Hello. Ailethia speaking. Your fallout estimator has new predictions. Want to see what's coming?",
  "Hi there. I'm Ailethia. Your TopTier performance engine is updated. Ready to review the rankings?",
  "Greetings. Ailethia here. I can help you understand your entire lending operation with clarity and precision. Where should we begin?",
  "Welcome back. I'm Ailethia. Your executive intelligence platform is ready. What would you like to explore first?",
  "Good morning. Ailethia speaking. I've been analyzing your performance signals. There are several insights worth your attention.",
  "Hello. I'm Ailethia. Your profitability and risk analysis is complete. Ready to review what matters most?",
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

