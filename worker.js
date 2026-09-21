const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

const MANUAL_TEST_URL =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/manual_test.json";

const STEAMHISTORY_SOURCEBANS_URL =
  "https://steamhistory.net/api/sourcebans";

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
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}nocache=${cacheBuster}`, {
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

function findRecordInData(data, lookup) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return data[lookup] || null;
}

async function findMcdbRecord(lookup) {
  // Always check the manually maintained test database first.
  const manual = await fetchManualTest();
  const manualRecord = findRecordInData(manual, lookup);

  if (manualRecord) {
    return manualRecord;
  }

  // SteamID64 can directly select one shard.
  if (isSteamID64(lookup)) {
    const shard = steam64Shard(lookup);
    const data = await fetchShard(shard);
    return findRecordInData(data, lookup);
  }

  // SteamID1 / SteamID3 may live anywhere, so search all shards.
  if (isSteamID1(lookup) || isSteamID3(lookup)) {
    const shards = Array.from({ length: 256 }, (_, i) =>
      i.toString(16).padStart(2, "0")
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

function isSteamID64Key(value) {
  return typeof value === "string" && isSteamID64(value);
}

function extractSourceBans(payload, steamID64) {
  if (payload == null) {
    return {
      available: true,
      banned: false,
      records: []
    };
  }

  // Common keyed response forms.
  const directCandidates = [
    payload?.[steamID64],
    payload?.data?.[steamID64],
    payload?.results?.[steamID64],
    payload?.sourcebans?.[steamID64],
    payload?.bans?.[steamID64]
  ];

  let candidate = directCandidates.find((value) => value !== undefined);

  // Common single-user / collection response forms.
  if (candidate === undefined) {
    const possibleCollections = [
      payload?.data,
      payload?.results,
      payload?.sourcebans,
      payload?.bans,
      payload
    ];

    for (const collection of possibleCollections) {
      if (Array.isArray(collection)) {
        const matching = collection.filter((entry) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }

          const ids = [
            entry.steamid,
            entry.steamid64,
            entry.steam_id,
            entry.authid,
            entry.id
          ];

          return ids.some((id) => String(id) === steamID64);
        });

        if (matching.length > 0) {
          candidate = matching;
          break;
        }
      }

      if (collection && typeof collection === "object") {
        const nestedBanArray =
          collection.bans ||
          collection.records ||
          collection.results ||
          collection.sourcebans;

        if (Array.isArray(nestedBanArray)) {
          candidate = nestedBanArray;
          break;
        }

        if (
          isSteamID64Key(collection.steamid) &&
          collection.steamid === steamID64
        ) {
          candidate = collection;
          break;
        }

        if (collection.steamid64 === steamID64) {
          candidate = collection;
          break;
        }
      }
    }
  }

  if (candidate === undefined) {
    return {
      available: true,
      banned: false,
      records: []
    };
  }

  if (Array.isArray(candidate)) {
    return {
      available: true,
      banned: candidate.length > 0,
      records: candidate
    };
  }

  if (candidate && typeof candidate === "object") {
    if (typeof candidate.banned === "boolean") {
      return {
        available: true,
        banned: candidate.banned,
        records: Array.isArray(candidate.bans)
          ? candidate.bans
          : candidate
      };
    }

    if (Array.isArray(candidate.bans)) {
      return {
        available: true,
        banned: candidate.bans.length > 0,
        records: candidate.bans
      };
    }

    return {
      available: true,
      banned: false,
      records: candidate
    };
  }

  return {
    available: true,
    banned: false,
    records: []
  };
}

async function fetchSourceBans(steamID64, apiKey) {
  if (!apiKey) {
    return {
      available: false,
      banned: false,
      records: [],
      error: "STEAMHISTORY_API_KEY is not configured"
    };
  }

  const params = new URLSearchParams({
    key: apiKey,
    shouldkey: "0",
    steamids: steamID64
  });

  const result = await fetchJson(
    `${STEAMHISTORY_SOURCEBANS_URL}?${params.toString()}`,
    `SteamHistory SourceBans ${steamID64}`
  );

  if (result == null) {
    return {
      available: false,
      banned: false,
      records: [],
      error: "SteamHistory SourceBans request failed"
    };
  }

  return extractSourceBans(result, steamID64);
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

      if (url.pathname === "/" || url.pathname === "") {
        return json({
          ok: true,
          service: "MCDB API",
          version: 3,
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
        return json(
          {
            found: false,
            error: "Missing Steam ID"
          },
          400
        );
      }

      const record = await findMcdbRecord(lookupValue);
      const result = record ? buildResult(record, lookupValue) : null;

      // SourceBans needs a SteamID64. If the lookup was a SteamID1/3,
      // use the MCDB canonical ID when available.
      const steamID64 = isSteamID64(lookupValue)
        ? lookupValue
        : record?.id || null;

      const sourcebans = steamID64
        ? await fetchSourceBans(
            steamID64,
            env?.STEAMHISTORY_API_KEY
          )
        : {
            available: false,
            banned: false,
            records: [],
            error: "No SteamID64 available for SourceBans lookup"
          };

      if (result) {
        return json({
          ...result,
          sourcebans
        });
      }

      return json({
        found: false,
        lookup: lookupValue,
        sourcebans
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
