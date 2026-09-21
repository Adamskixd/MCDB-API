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

const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Health check
    if (parts.length === 0 || parts[0] === "health") {
      return json({
        ok: true,
        service: "mcdb-api",
        version: 1
      });
    }

    // Validate lookup request
    if (parts[0] !== "lookup" || !parts[1]) {
      return json(
        {
          error: "Use /lookup/<steamid64|steamid|steam3>"
        },
        404
      );
    }

    const identifier = decodeURIComponent(
      parts.slice(1).join("/")
    ).trim();

    if (!identifier) {
      return json(
        {
          error: "Missing identifier"
        },
        400
      );
    }

    /*
     * SteamID64:
     * The last two characters determine the shard.
     */
    if (/^\d{17}$/.test(identifier)) {
      const shard = identifier.slice(-2).toLowerCase();

      return lookupShard(shard, identifier);
    }

    /*
     * SteamID / Steam3:
     * Search all 256 shards.
     */
    const shards = [];

    for (let i = 0; i < 256; i++) {
      shards.push(
        i.toString(16).padStart(2, "0")
      );
    }

    const results = await Promise.all(
      shards.map(async (shard) => {
        const data = await fetchShard(shard);

        if (!data) {
          return null;
        }

        return (
          data[identifier] ||
          data[identifier.toLowerCase()] ||
          null
        );
      })
    );

    const player = results.find(Boolean);

    if (player) {
      return json({
        found: true,
        player
      });
    }

    return json(
      {
        found: false
      },
      404
    );
  }
};


/**
 * Look up an identifier inside a specific shard.
 */
async function lookupShard(shard, identifier) {
  const data = await fetchShard(shard);

  if (!data) {
    return json(
      {
        found: false
      },
      404
    );
  }

  const player =
    data[identifier] ||
    data[identifier.toLowerCase()] ||
    null;

  if (!player) {
    return json(
      {
        found: false
      },
      404
    );
  }

  return json({
    found: true,
    player
  });
}


/**
 * Fetch a shard from GitHub.
 *
 * No Cloudflare cache.
 * No browser/API response cache.
 *
 * The timestamp makes every GitHub URL unique,
 * preventing an intermediary from reusing an
 * older response.
 */
async function fetchShard(shard) {
  const cacheBuster = Date.now();

  const response = await fetch(
    `${REPO_RAW_BASE}/${shard}.json?nocache=${cacheBuster}`,
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}


/**
 * Return a response with caching completely disabled.
 */
function json(value, status = 200) {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control":
          "no-store, no-cache, must-revalidate, max-age=0",
        "pragma": "no-cache",
        "expires": "0"
      }
    }
  );
}
