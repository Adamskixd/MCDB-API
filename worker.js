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
  "stac",
  "multihack"
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
  // Manual test database gets checked first.
  const manual = await fetchManualTest();

  const manualRecord = findRecordInData(
    manual,
    lookup
  );

  if (manualRecord) {
    return manualRecord;
  }

  // SteamID64 directly determines the shard.
  if (isSteamID64(lookup)) {
    const shard = steam64Shard(lookup);
    const data = await fetchShard(shard);

    return findRecordInData(data, lookup);
  }

  // SteamID1 / Steam3 can exist in any shard.
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
 * SteamHistory search
 *
 * This is useful for locating the SteamHistory profile.
 * The actual SourceBans data is requested separately below.
 */
async function searchSteamHistory(steamID64) {
  const result = await postJson(
    STEAMHISTORY_SEARCH_URL,
    {
      query: steamID64
    },
    `SteamHistory search ${steamID64}`
  );

  return result;
}

/*
 * Recursively collect fields named:
 *
 *   keyword
 *   keywords
 *
 * This handles strings, arrays and nested objects.
 */
function collectKeywordFields(value, output = []) {
  if (value == null) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeywordFields(item, output);
    }

    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (/^keywords?$/i.test(key)) {
      if (Array.isArray(fieldValue)) {
        for (const item of fieldValue) {
          output.push(String(item));
        }
      } else if (fieldValue != null) {
        output.push(String(fieldValue));
      }
    }

    collectKeywordFields(fieldValue, output);
  }

  return output;
}

function scanSourceBansKeywords(payload) {
  const keywordFields = collectKeywordFields(payload);

  const combinedText = keywordFields
    .join(" ")
    .toLowerCase();

  const matchedKeywords = SOURCEBANS_KEYWORDS.filter(
    (keyword) =>
      combinedText.includes(keyword.toLowerCase())
  );

  return {
    keywordMatch: matchedKeywords.length > 0,
    matchedKeywords,
    keywordFields
  };
}

function extractSourceBansRecords(payload, steamID64) {
  if (payload == null) {
    return [];
  }

  const possibleArrays = [
    payload?.bans,
    payload?.records,
    payload?.results,
    payload?.sourcebans,
    payload?.data,
    payload
  ];

  for (const value of possibleArrays) {
    if (!Array.isArray(value)) {
      continue;
    }

    const matching = value.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const ids = [
        entry.steamid,
        entry.steamID,
        entry.steamid64,
        entry.steamID64,
        entry.steam_id,
        entry.authid,
        entry.id
      ];

      // If no SteamID field exists, retain the record because
      // the endpoint was queried specifically for this SteamID.
      const hasMatchingID = ids.some(
        (id) => String(id) === steamID64
      );

      return hasMatchingID || ids.every(
        (id) => id == null
      );
    });

    if (matching.length > 0) {
      return matching;
    }

    if (value.length > 0) {
      return value;
    }
  }

  // Keyed response:
  // { "7656119...": [...] }
  if (
    payload &&
    typeof payload === "object" &&
    payload[steamID64] !== undefined
  ) {
    const value = payload[steamID64];

    if (Array.isArray(value)) {
      return value;
    }

    if (value && typeof value === "object") {
      return [value];
    }
  }

  // Single record response.
  if (
    payload &&
    typeof payload === "object" &&
    (
      payload.steamid === steamID64 ||
      payload.steamid64 === steamID64 ||
      payload.steamID64 === steamID64
    )
  ) {
    return [payload];
  }

  return [];
}

async function fetchSourceBans(
  steamID64,
  apiKey
) {
  if (!apiKey) {
    return {
      available: false,
      banned: false,
      keywordMatch: false,
      matchedKeywords: [],
      records: [],
      error:
        "STEAMHISTORY_API_KEY is not configured"
    };
  }

  const params = new URLSearchParams({
    key: apiKey,
    shouldkey: "0",
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
        error:
          `SteamHistory HTTP ${response.status}`
      };
    }

    let payload;

    try {
      payload = await response.json();
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
        error:
          "SteamHistory returned invalid JSON"
      };
    }

    const records =
      extractSourceBansRecords(
        payload,
        steamID64
      );

    const keywordScan =
      scanSourceBansKeywords(payload);

    return {
      available: true,

      // A SourceBans record exists.
      banned: records.length > 0,

      // One of our cheating-related keywords was found
      // inside a "keyword" / "keywords" field.
      keywordMatch:
        keywordScan.keywordMatch,

      matchedKeywords:
        keywordScan.matchedKeywords,

      records
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
      error:
        "SteamHistory SourceBans request failed"
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
          version: 4,
          usage:
            "/lookup/<steamid64|steamid1|steamid3>"
        });
      }

      const match =
        url.pathname.match(
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
       * First resolve MCDB.
       */
      const record =
        await findMcdbRecord(
          lookupValue
        );

      const mcdbResult =
        record
          ? buildResult(
              record,
              lookupValue
            )
          : null;

      /*
       * SourceBans requires SteamID64.
       *
       * If the caller supplied SteamID1 / Steam3,
       * use the canonical ID from MCDB.
       */
      const steamID64 =
        isSteamID64(lookupValue)
          ? lookupValue
          : record?.id || null;

      let steamHistory = null;

      let sourcebans = {
        available: false,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        error:
          "No SteamID64 available for SourceBans lookup"
      };

      if (steamID64) {
        /*
         * Search SteamHistory profile.
         *
         * This is informational and does not determine
         * whether the player is flagged.
         */
        steamHistory =
          await searchSteamHistory(
            steamID64
          );

        /*
         * Check SourceBans.
         */
        sourcebans =
          await fetchSourceBans(
            steamID64,
            env?.STEAMHISTORY_API_KEY
          );
      }

      /*
       * MCDB match OR SourceBans keyword match
       * can be consumed by the Lua detector.
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
