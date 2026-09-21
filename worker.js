const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

const MANUAL_TEST_URL =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/manual_test.json";

const STEAMHISTORY_SEARCH_URL =
  "https://steamhistory.net/api/search";

const STEAMHISTORY_SOURCEBANS_URL =
  "https://steamhistory.net/api/sourcebans";

const SOURCEBANS_KEYWORDS = [
  "cheat",
  "aimbot",
  "hack",
  "wallhack",
  "multihack",
  "[stac]",
  "smac ",
  "[ac]",
  "anti-cheat"
];

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
  try {
    return decodeURIComponent(value || "").trim();
  } catch {
    return String(value || "").trim();
  }
}

function steam64Shard(steamID64) {
  return steamID64.slice(-2).toLowerCase();
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

async function fetchJson(url, label) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const cacheBuster = `nocache=${Date.now()}`;

    const response = await fetch(
      `${url}${separator}${cacheBuster}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

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

async function postJson(url, body, label) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
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
    `MCDB shard ${shard}`
  );
}

async function fetchManualTest() {
  return fetchJson(
    MANUAL_TEST_URL,
    "MCDB manual_test.json"
  );
}

function findRecordInData(data, lookup) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return data[lookup] || null;
}

async function findMcdbRecord(lookup) {
  // Manual database is checked first.
  const manual = await fetchManualTest();
  const manualRecord = findRecordInData(manual, lookup);

  if (manualRecord) {
    return manualRecord;
  }

  // SteamID64 -> direct shard lookup.
  if (isSteamID64(lookup)) {
    const shard = steam64Shard(lookup);
    const data = await fetchShard(shard);

    return findRecordInData(data, lookup);
  }

  // SteamID1 / Steam3 -> search all shards.
  if (isSteamID1(lookup) || isSteamID3(lookup)) {
    const shards = Array.from(
      { length: 256 },
      (_, i) => i.toString(16).padStart(2, "0")
    );

    const results = await Promise.all(
      shards.map(async (shard) => {
        const data = await fetchShard(shard);
        return findRecordInData(data, lookup);
      })
    );

    return results.find(Boolean) || null;
  }

  return null;
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
    aliases: Array.isArray(record.aliases)
      ? record.aliases
      : []
  };
}

/*
 * SteamHistory profile search.
 */
async function searchSteamHistory(steamID64) {
  return postJson(
    STEAMHISTORY_SEARCH_URL,
    {
      query: steamID64
    },
    `SteamHistory search ${steamID64}`
  );
}

/*
 * Scan SourceBans BanReason values for keywords.
 */
function analyzeSourceBans(bans) {
  const activeBans = bans.filter(
    (ban) =>
      ban &&
      String(ban.CurrentState || "").toLowerCase() !== "unbanned"
  );

  const matchedKeywords = new Set();

  for (const ban of activeBans) {
    const reason = String(
      ban?.BanReason || ""
    ).toLowerCase();

    for (const keyword of SOURCEBANS_KEYWORDS) {
      if (reason.includes(keyword.toLowerCase())) {
        matchedKeywords.add(keyword);
      }
    }
  }

  return {
    banned: activeBans.length > 0,
    activeBans,
    keywordMatch: matchedKeywords.size > 0,
    matchedKeywords: [...matchedKeywords]
  };
}

/*
 * SteamHistory SourceBans response is expected to look like:
 *
 * {
 *   "response": {
 *     "7656119...": [
 *       {
 *         "CurrentState": "...",
 *         "BanReason": "..."
 *       }
 *     ]
 *   }
 * }
 */
async function fetchSourceBans(steamID64, apiKey) {
  if (!apiKey) {
    return {
      available: false,
      banned: false,
      keywordMatch: false,
      matchedKeywords: [],
      records: [],
      activeBans: [],
      error: "STEAMHISTORY_API_KEY is not configured"
    };
  }

  const params = new URLSearchParams({
    key: apiKey,

    // SteamHistory SourceBans API format.
    shouldkey: "1",

    steamids: steamID64
  });

  try {
    const response = await fetch(
      `${STEAMHISTORY_SOURCEBANS_URL}?${params.toString()}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      console.error(
        `SteamHistory SourceBans: HTTP ${response.status}`
      );

      return {
        available: false,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: [],
        error: `SteamHistory HTTP ${response.status}`
      };
    }

    let data;

    try {
      data = await response.json();
    } catch (error) {
      console.error(
        "SteamHistory SourceBans: invalid JSON",
        error
      );

      return {
        available: false,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: [],
        error: "SteamHistory returned invalid JSON"
      };
    }

    const bans = data?.response?.[steamID64];

    if (!Array.isArray(bans)) {
      return {
        available: true,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: []
      };
    }

    const analysis = analyzeSourceBans(bans);

    return {
      available: true,
      banned: analysis.banned,
      keywordMatch: analysis.keywordMatch,
      matchedKeywords: analysis.matchedKeywords,
      records: bans,
      activeBans: analysis.activeBans
    };
  } catch (error) {
    console.error(
      "SteamHistory SourceBans request failed:",
      error
    );

    return {
      available: false,
      banned: false,
      keywordMatch: false,
      matchedKeywords: [],
      records: [],
      activeBans: [],
      error: "SteamHistory SourceBans request failed"
    };
  }
}

export default {
  async fetch(request, env) {
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

      if (
        url.pathname === "/" ||
        url.pathname === ""
      ) {
        return json({
          ok: true,
          service: "MCDB API",
          version: 5,
          usage: "/lookup/<steamid64|steamid1|steamid3>"
        });
      }

      const match = url.pathname.match(
        /^\/lookup\/(.+)$/
      );

      if (!match) {
        return json(
          {
            found: false,
            error: "Not found"
          },
          404
        );
      }

      const lookupValue =
        normalizeLookup(match[1]);

      if (!lookupValue) {
        return json(
          {
            found: false,
            error: "Missing Steam ID"
          },
          400
        );
      }

      /*
       * 1. MCDB lookup
       */
      const record =
        await findMcdbRecord(lookupValue);

      const mcdbResult =
        record
          ? buildResult(
              record,
              lookupValue
            )
          : null;

      /*
       * 2. Resolve SteamID64
       */
      const steamID64 =
        isSteamID64(lookupValue)
          ? lookupValue
          : record?.id || null;

      /*
       * 3. SteamHistory + SourceBans
       */
      let steamHistory = null;

      let sourcebans = {
        available: false,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: [],
        error:
          "No SteamID64 available for SourceBans lookup"
      };

      if (steamID64) {
        steamHistory =
          await searchSteamHistory(
            steamID64
          );

        sourcebans =
          await fetchSourceBans(
            steamID64,
            env?.STEAMHISTORY_API_KEY
          );
      }

      /*
       * 4. Final detector flag.
       *
       * MCDB match OR an active SourceBans
       * keyword match = cheaterMatch.
       */
      const cheaterMatch =
        Boolean(mcdbResult) ||
        sourcebans.keywordMatch === true;

      if (mcdbResult) {
        return json({
          ...mcdbResult,
          cheaterMatch,
          steamHistory,
          sourcebans
        });
      }

      return json({
        found: false,
        lookup: lookupValue,
        cheaterMatch,
        steamHistory,
        sourcebans
      });
    } catch (error) {
      console.error(
        "Unhandled Worker error:",
        error
      );

      return json(
        {
          found: false,
          cheaterMatch: false,
          error: "Internal server error"
        },
        500
      );
    }
  }
};
