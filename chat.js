// netlify/functions/chat.js
// Tries Groq first (fast, generous free tier), and automatically falls back to
// Gemini if Groq fails (rate limit, quota exhausted, outage, etc.) - as long as
// both GROQ_API_KEY and GEMINI_API_KEY are set. If only one key is set, that
// provider is used directly with no fallback attempt.
//
// Get free keys:
//   Groq:   https://console.groq.com/keys
//   Gemini: https://aistudio.google.com/app/apikey

const GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
const GEMINI_MODEL = "gemini-2.5-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method not allowed" };

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) {
    return json(500, { error: "Neither GROQ_API_KEY nor GEMINI_API_KEY is set on the server." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return json(400, { error: "Invalid request body." });
  }

  let lastError = null;

  if (groqKey) {
    try {
      const text = await callGroq(payload, groqKey);
      return json(200, { content: [{ type: "text", text: text }], provider: "groq" });
    } catch (err) {
      lastError = err;
    }
  }

  if (geminiKey) {
    try {
      const text = await callGemini(payload, geminiKey);
      return json(200, { content: [{ type: "text", text: text }], provider: "gemini", fellBack: !!groqKey });
    } catch (err) {
      lastError = err;
    }
  }

  return json((lastError && lastError.status) || 500, {
    error: (lastError && lastError.message) || "All providers failed."
  });
};

function json(statusCode, obj) {
  return { statusCode: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

async function callGroq(payload, apiKey) {
  var hasImage = false;
  const chatMessages = (payload.messages || []).map(function (msg) {
    var content;
    if (typeof msg.content === "string") {
      content = msg.content;
    } else {
      content = msg.content.map(function (block) {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "image") {
          hasImage = true;
          return { type: "image_url", image_url: { url: "data:" + block.source.media_type + ";base64," + block.source.data } };
        }
        return { type: "text", text: "" };
      });
    }
    return { role: msg.role, content: content };
  });
  const fullMessages = [{ role: "system", content: payload.system || "" }].concat(chatMessages);
  const model = hasImage ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({ model: model, messages: fullMessages, max_completion_tokens: payload.max_tokens || 1000 })
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error("Groq: " + ((data.error && data.error.message) || "request failed"));
    err.status = res.status;
    throw err;
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return text || "I didn't quite catch that, could you try again?";
}

async function callGemini(payload, apiKey) {
  const contents = (payload.messages || []).map(function (msg) {
    var parts;
    if (typeof msg.content === "string") {
      parts = [{ text: msg.content }];
    } else {
      parts = msg.content.map(function (block) {
        if (block.type === "text") return { text: block.text };
        if (block.type === "image") return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
        return { text: "" };
      });
    }
    return { role: msg.role === "assistant" ? "model" : "user", parts: parts };
  });

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: payload.system || "" }] },
        contents: contents,
        generationConfig: { maxOutputTokens: payload.max_tokens || 1000 }
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const err = new Error("Gemini: " + ((data.error && data.error.message) || "request failed"));
    err.status = res.status;
    throw err;
  }
  var candidate = data.candidates && data.candidates[0];
  var text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map(function (p) { return p.text || ""; }).join("")
    : "";
  return text || "I didn't quite catch that, could you try again?";
}
