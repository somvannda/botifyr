/**
 * Shared Botifyr UI primitives and components.
 *
 * Extracted from the desktop app so the web portal renders the exact same
 * icons, logos, markdown and styles. Anything here must stay free of
 * Tauri/browser-specific APIs — those live behind a platform bridge in the host
 * app.
 */
export * from "./Icons";
export * from "./BotLogo";
export * from "./BrandIcons";
export * from "./AppIcons";
export * from "./Markdown";
export { BotifyrApp, TITLEBAR_SLOT_ID } from "./BotifyrApp";
export { webBridge, defaultBridge, type BotBridge } from "./bridge";
export { Select, type SelectOption } from "./Select";
