import type { NormalizedConversation } from "../types.js";

export function renderJson(conversation: NormalizedConversation): string {
  return `${JSON.stringify(conversation, null, 2)}\n`;
}

export function renderMarkdown(conversation: NormalizedConversation): string {
  const title = conversation.title || `${conversation.provider} ${conversation.providerConversationId}`;
  const lines = [
    `# ${title}`,
    "",
    `Provider: ${conversation.provider}`,
    `Started: ${conversation.startedAt}`,
    `Source: ${conversation.source.path}`,
  ];

  if (conversation.project) {
    lines.push(`Project: ${conversation.project.name}`);
  }

  lines.push("");

  for (const message of conversation.messages) {
    lines.push(`## ${message.role}`);
    if (message.createdAt) lines.push(`Created: ${message.createdAt}`);
    if (message.toolName) lines.push(`Tool: ${message.toolName}`);
    lines.push("");
    lines.push(message.text || "");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
