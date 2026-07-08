// netlify/functions/search.js
// Free, keyless web search via DuckDuckGo's HTML results page (no official API
// needed). Returns the top few result titles/snippets as plain text for the
// assistant to read and answer from. Best-effort: DuckDuckGo's markup can
// change, and this is not as thorough as a real search API, but it's free.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method not allowed" };

  let query;
  try {
    query = JSON.parse(event.body).query;
  } catch (e) {
    return respond(400, { error: "Invalid request body." });
  }
  if (!query || !query.trim()) return respond(400, { error: "Missing query." });

  try {
    const res = await fetch("https://duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });
    const html = await res.text();
    const results = parseResults(html).slice(0, 4);
    if (!results.length) {
      return respond(200, { results: [], summary: "No web results found for \"" + query + "\"." });
    }
    const summary = results
      .map(function (r, i) { return (i + 1) + ". " + r.title + " \u2014 " + r.snippet; })
      .join("\n");
    return respond(200, { results: results, summary: summary });
  } catch (err) {
    return respond(500, { error: "Search failed: " + err.message });
  }
};

function parseResults(html) {
  const results = [];
  const blockRe = /<a rel="nofollow" class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = blockRe.exec(html)) && results.length < 6) {
    results.push({ title: stripTags(match[1]), snippet: stripTags(match[2]) });
  }
  return results;
}

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function respond(statusCode, obj) {
  return { statusCode: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
