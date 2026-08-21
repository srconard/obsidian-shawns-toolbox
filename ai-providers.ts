// ai-providers.ts — the OpenAI chat-completions call for AI Thought.
// (Gemini's callGeminiApi lives in block-summarizer.ts, where it originated;
// this file holds the alternative provider so either can turn a transcript
// into bullets.) Uses Obsidian's requestUrl like every other API call here.

import { requestUrl } from "obsidian";

export async function callOpenAiApi(
	apiKey: string,
	model: string,
	promptText: string,
	maxTokens = 600
): Promise<string> {
	const response = await requestUrl({
		url: "https://api.openai.com/v1/chat/completions",
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		// No temperature: newer OpenAI models reject non-default values.
		// max_completion_tokens is the modern name (max_tokens is rejected
		// by reasoning-class models).
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: promptText }],
			max_completion_tokens: maxTokens,
		}),
	});
	const content = response.json?.choices?.[0]?.message?.content;
	if (typeof content !== "string" || !content.trim()) {
		throw new Error("Unexpected OpenAI response: no message content");
	}
	return content;
}
