/**
 * Shared default preset configuration.
 * Used as the fallback when a shop has no saved preset config,
 * and as the base schema for the admin config page.
 */
export const DEFAULT_PRESET = {
  heading: "Hey, I'm your Store Assistant",
  subtext:  "Ask me anything about products, orders, or returns.",
  featureCards: [
    { icon: "🔍", title: "Find products",  desc: "Search our catalog by type, brand, or use case",       chip: "Find me some products" },
    { icon: "📦", title: "Track orders",   desc: "Real-time status for any order in your history",       chip: "Track my latest order" },
    { icon: "↩️", title: "Easy returns",   desc: "Start a return or exchange in seconds",                chip: "I'd like to start a return" },
    { icon: "🎁", title: "Gift finder",    desc: "Personalized picks for any occasion and budget",       chip: "Help me find a gift" },
  ],
  suggestionChips: [
    { text: "Popular products", chip: "Find me popular products" },
    { text: "Shipping times",   chip: "What are your shipping times?" },
    { text: "Return policy",    chip: "What is your return policy?" },
    { text: "Gift ideas",       chip: "Help me find a gift under $100" },
  ],
  quickBarChips: [
    { icon: "🔍", text: "Search",      chip: "Search products" },
    { icon: "📦", text: "Track order", chip: "Track my order" },
    { icon: "↩️", text: "Returns",     chip: "I need to return something" },
    { icon: "🏷️", text: "Deals",       chip: "Show me deals and discounts" },
    { icon: "🎁", text: "Gifts",       chip: "Help me find a gift" },
  ],
};
