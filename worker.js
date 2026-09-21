/**
 * MCDB lookup API
 *
 * Deploy this as a Cloudflare Worker.
 * Set REPO_RAW_BASE to the raw GitHub URL containing data/shards.
 *
 * Example:
 *   GET /lookup/76561199291189951
 *   GET /lookup/STEAM_1:1:665462111
 *   GET /lookup/[U:1:1330924223]
 */

const REPO_RAW_BASE = "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length === 0 || parts[0] === "health") {
      return json({ ok: true, service: "mcdb-api", version: 1 });
    }

    if (parts[0] !== "lookup" || !parts[1]) {
      return json({ error: "Use /lookup/<steamid64|steamid|steam3>" }, 404);
    }

    const identifier = decodeURIComponent(parts.slice(1).join("/")).trim();
    if (!identifier) return json({ error: "Missing identifier" }, 400);

    // SteamID64 can be sharded directly.
    // SteamID/Steam3 need a small deterministic scan across 256 shards.
    if (/^\d{17}$/.test(identifier)) {
      const shard = identifier.slice(-2).toLowerCase();
      return lookupShard(shard, identifier);
    }

    // For non-Steam64 identifiers, search all shards concurrently.
    const keys = [];
    for (let i = 0; i < 256; i++) keys.push(i.toString(16).padStart(2, "0"));

    const found = await Promise.all(keys.map(async (shard) => {
      const result = await fetchShard(shard);
      if (!result) return null;
      return result[identifier] || result[identifier.toLowerCase()] || null;
    }));

    const player = found.find(Boolean);
    return player
      ? json({ found: true, player })
      : json({ found: false }, 404);
  }
};

async function lookupShard(shard, identifier) {
  const data = await fetchShard(shard);
  const player = data && data[identifier];
  return player
    ? json({ found: true, player })
    : json({ found: false }, 404);
}

async function fetchShard(shard) {
  const response = await fetch(`${REPO_RAW_BASE}/${shard}.json`, {
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) return null;
  return response.json();
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}
