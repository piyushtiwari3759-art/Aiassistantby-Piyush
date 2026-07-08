// netlify/functions/transcribe.js
// Transcribes recorded audio via Groq's free Whisper API (whisper-large-v3-turbo).
// Reuses the same GROQ_API_KEY already used for chat - no separate key needed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method not allowed" };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return respond(500, { error: "GROQ_API_KEY is not set on the server." });

  let audioBase64, mimeType;
  try {
    var body = JSON.parse(event.body);
    audioBase64 = body.audioBase64;
    mimeType = body.mimeType || "audio/webm";
  } catch (e) {
    return respond(400, { error: "Invalid request body." });
  }
  if (!audioBase64) return respond(400, { error: "Missing audio data." });

  try {
    const buffer = Buffer.from(audioBase64, "base64");
    const ext = mimeType.indexOf("mp4") !== -1 ? "mp4" : "webm";
    const blob = new Blob([buffer], { type: mimeType });

    const form = new FormData();
    form.append("file", blob, "audio." + ext);
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey },
      body: form
    });
    const data = await res.json();
    if (!res.ok) {
      return respond(res.status, { error: (data.error && data.error.message) || "Transcription failed" });
    }
    return respond(200, { text: data.text || "" });
  } catch (err) {
    return respond(500, { error: "Transcription error: " + err.message });
  }
};

function respond(statusCode, obj) {
  return { statusCode: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
