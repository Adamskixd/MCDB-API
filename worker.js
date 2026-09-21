const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

const MANUAL_TEST_URL =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/manual_test.json";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0"
    }
  });
}

function normalizeLookup(value) {
  return decodeURIComponent(value || "").trim();
}

function steam64Shard(steamID64) {
  return steamID64.slice(-2).toLowerCase();
}

async function fetchJson(url, label) {
  const cacheBuster = Date.now();

  try {
    const response = await fetch(`${url}?nocache=${cacheBuster}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      console.error(`${label}: HTTP ${response.status}`);
      return null;
    }

    try {
      return await response.json();
    } catch (error) {
      console.error(`${label}: invalid JSON`, error);
      return null;
    }
  } catch (error) {
    console.error(`${label}: fetch failed`, error);
    return null;
  }
}

async function fetchShard(shard) {
  return fetchJson(
    `${REPO_RAW_BASE}/${shard}.json`,
    `shard ${shard}`
  );
}

async function fetchManualTest() {
  return fetchJson(MANUAL_TEST_URL, "manual_test.json");
}

function isSteamID64(value) {
  return /^7656119\d{10}$/.test(value);
}

function isSteamID1(value) {
  return /^STEAM_[0-5]:[01]:\d+$/.test(value);
}

function isSteamID3(value) {
  return /^\[U:\d+:\d+\]$/.test(value);
}

function buildResult(record, lookup) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    found: true,
    lookup,
    id: record.id || null,
    id1: record.id1 || null,
    id3: record.id3 || null,
    label: record.label || null,
    aliases: Array.isArray(record.aliases) ? record.aliases : []
  };
}

async function lookup(request, lookup) {
  // Always check the manually maintained test database first.
  const manual = await fetchManualTest();
  const manualRecord = manual?.[lookup];

  if (manualRecord) {
    return buildResult(manualRecord, lookup);
  }

  // SteamID64 can directly select one shard.
  if (isSteamID64(lookup)) {
    const shard = steam64Shard(lookup);
    const data = await fetchShard(shard);
    const record = data?.[lookup];

    if (record) {
      return buildResult(record, lookup);
    }

    return null;
  }

  // SteamID1 / SteamID3 may live anywhere, so search all shards.
  if (isSteamID1(lookup) || isSteamID3(lookup)) {
    const shards = Array.from({ length: 256 }, (_, i) =>
      i.toString(16).padStart(2, "0")
    );

    const results = await Promise.all(
      shards.map(async (shard) => {
        const data = await fetchShard(shard);
        return data?.[lookup] || null;
      })
    );

    const record = results.find(Boolean);

    if (record) {
      return buildResult(record, lookup);
    }

    return null;
  }

  return null;
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.method !== "GET") {
        return json(
          {
            found: false,
            error: "Method not allowed"
          },
          405
        );
      }

      if (url.pathname === "/" || url.pathname === "") {
        return json({
          ok: true,
          service: "MCDB API",
          version: 2,
          usage: "/lookup/<steamid64|steamid1|steamid3>"
        });
      }

      const match = url.pathname.match(/^\/lookup\/(.+)$/);

      if (!match) {
        return json(
          {
            found: false,
            error: "Not found"
          },
          404
        );
      }

      const lookupValue = normalizeLookup(match[1]);

      if (!lookupValue) {
        return json({
          found: false,
          error: "Missing Steam ID"
        }, 400);
      }

      const result = await lookup(request, lookupValue);

      if (result) {
        return json(result);
      }

      return json({
        found: false,
        lookup: lookupValue
      });
    } catch (error) {
      console.error("Unhandled Worker error:", error);

      return json(
        {
          found: false,
          error: "Internal server error"
        },
        500
      );
    }
  }
};
