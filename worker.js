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
  const manual = await fetchManualTest();
  const manualRecord = findRecordInData(manual, lookup);

  if (manualRecord) {
    return manualRecord;
  }

  if (isSteamID64(lookup)) {
    const shard = steam64Shard(lookup);
    const data = await fetchShard(shard);

    return findRecordInData(data, lookup);
  }

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
  SteamHistory uses TF2BD as one of the community-data sources.

  Normalized output:

  "tf2bd": {
    "listed": true,
    "classification": "Cheater",
    "sources": [
      "Vorobey-HackerPolice"
    ]
  }

  The extractor is intentionally tolerant of nesting/casing.
*/
function extractTf2bdFromNode(node, visited = new Set()) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (visited.has(node)) {
    return null;
  }

  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = extractTf2bdFromNode(
        item,
        visited
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = String(key)
      .toLowerCase()
      .replace(/[\s_-]/g, "");

    if (
      normalizedKey === "tf2bd" ||
      normalizedKey === "tf2botdetector"
    ) {
      if (value && typeof value === "object") {
        const listed =
          value.listed === true ||
          value.isListed === true ||
          value.Listed === true;

        const classification =
          value.classification ??
          value.Classification ??
          value.status ??
          value.Status ??
          null;

        const rawSources =
          value.sources ??
          value.Sources ??
          value.source ??
          value.Source ??
          [];

        const sources = Array.isArray(rawSources)
          ? rawSources
              .map((source) => String(source).trim())
              .filter(Boolean)
          : rawSources
            ? [String(rawSources).trim()].filter(Boolean)
            : [];

        return {
          listed,
          classification:
            classification == null
              ? null
              : String(classification),
          sources
        };
      }
    }
  }

  for (const value of Object.values(node)) {
    const result = extractTf2bdFromNode(
      value,
      visited
    );

    if (result) {
      return result;
    }
  }

  return null;
}

function normalizeTf2bd(steamHistory) {
  const extracted = extractTf2bdFromNode(
    steamHistory
  );

  if (!extracted) {
    return {
      listed: false,
      classification: null,
      sources: []
    };
  }

  return {
    listed: extracted.listed === true,
    classification: extracted.classification,
    sources: extracted.sources
  };
}

function extractCommunityFromNode(
  node,
  visited = new Set()
) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (visited.has(node)) {
    return null;
  }

  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = extractCommunityFromNode(
        item,
        visited
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = String(key)
      .toLowerCase()
      .replace(/[\s_-]/g, "");

    if (
      normalizedKey === "community" ||
      normalizedKey === "communitybans"
    ) {
      if (value && typeof value === "object") {
        const possibleCheater =
          value.possibleCheater === true ||
          value.PossibleCheater === true;

        const rawKeywords =
          value.keywords ??
          value.Keywords ??
          [];

        const keywords = Array.isArray(rawKeywords)
          ? rawKeywords
              .map((keyword) => String(keyword).trim())
              .filter(Boolean)
          : rawKeywords
            ? [String(rawKeywords).trim()].filter(Boolean)
            : [];

        return {
          possibleCheater,
          keywords
        };
      }
    }
  }

  for (const value of Object.values(node)) {
    const result = extractCommunityFromNode(
      value,
      visited
    );

    if (result) {
      return result;
    }
  }

  return null;
}

function normalizeCommunity(steamHistory) {
  const extracted =
    extractCommunityFromNode(steamHistory);

  if (!extracted) {
    return {
      possibleCheater: false,
      keywords: []
    };
  }

  return {
    possibleCheater:
      extracted.possibleCheater === true,
    keywords: extracted.keywords
  };
}

function isTf2bdCheater(tf2bd) {
  return (
    tf2bd &&
    tf2bd.listed === true &&
    String(
      tf2bd.classification || ""
    ).toLowerCase() === "cheater"
  );
}

/*
  Normalize SourceBans dates.

  Supports:
  - Unix timestamps in seconds
  - Unix timestamps in milliseconds
  - ISO date strings
  - common SourceBans date field names
*/
function normalizeBanDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const milliseconds =
      value < 100000000000
        ? value * 1000
        : value;

    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  }

  const stringValue =
    String(value).trim();

  if (!stringValue) {
    return null;
  }

  if (/^\d{10,13}$/.test(stringValue)) {
    const numericValue =
      Number(stringValue);

    const milliseconds =
      stringValue.length <= 10
        ? numericValue * 1000
        : numericValue;

    const date =
      new Date(milliseconds);

    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  }

  const parsed =
    Date.parse(stringValue);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function extractBanDate(ban) {
  if (
    !ban ||
    typeof ban !== "object"
  ) {
    return null;
  }

  const preferredKeys = [
    "BanDate",
    "BanTime",
    "banDate",
    "banTime",
    "CreatedAt",
    "Created",
    "createdAt",
    "created",
    "Date",
    "date",
    "Timestamp",
    "timestamp",
    "Time",
    "time",
    "IssuedAt",
    "issuedAt",
    "Issued",
    "issued",
    "BanCreated",
    "banCreated",
    "CreatedOn",
    "createdOn"
  ];

  for (const key of preferredKeys) {
    if (
      Object.prototype.hasOwnProperty.call(
        ban,
        key
      )
    ) {
      const normalized =
        normalizeBanDate(ban[key]);

      if (normalized) {
        return normalized;
      }
    }
  }

  const normalizedKeys =
    new Map();

  for (const [key, value] of Object.entries(ban)) {
    const normalizedKey =
      String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    normalizedKeys.set(
      normalizedKey,
      value
    );
  }

  const fallbackKeys = [
    "bandate",
    "bantime",
    "createdat",
    "created",
    "date",
    "timestamp",
    "time",
    "issuedat",
    "issued",
    "bancreated",
    "createdon"
  ];

  for (const key of fallbackKeys) {
    if (normalizedKeys.has(key)) {
      const normalized =
        normalizeBanDate(
          normalizedKeys.get(key)
        );

      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function decorateBanRecord(ban) {
  if (
    !ban ||
    typeof ban !== "object"
  ) {
    return ban;
  }

  const banDate =
    extractBanDate(ban);

  if (!banDate) {
    return {
      ...ban
    };
  }

  return {
    ...ban,
    banDate
  };
}

function getLatestBanDate(bans) {
  let latest = null;

  for (const ban of bans) {
    const date =
      ban?.banDate;

    if (!date) {
      continue;
    }

    if (
      !latest ||
      Date.parse(date) >
        Date.parse(latest)
    ) {
      latest = date;
    }
  }

  return latest;
}

function analyzeSourceBans(bans) {
  const decoratedBans =
    bans.map(
      decorateBanRecord
    );

  const activeBans =
    decoratedBans.filter(
      (ban) =>
        ban &&
        String(
          ban.CurrentState || ""
        ).toLowerCase() !==
          "unbanned"
    );

  const matchedKeywords =
    new Set();

  for (const ban of activeBans) {
    const reason =
      String(
        ban?.BanReason || ""
      ).toLowerCase();

    for (
      const keyword of SOURCEBANS_KEYWORDS
    ) {
      if (
        reason.includes(
          keyword.toLowerCase()
        )
      ) {
        matchedKeywords.add(
          keyword
        );
      }
    }
  }

  return {
    banned:
      activeBans.length > 0,

    activeBans,

    keywordMatch:
      matchedKeywords.size > 0,

    matchedKeywords:
      [...matchedKeywords],

    latestBanDate:
      getLatestBanDate(
        decoratedBans
      ),

    activeBanDate:
      getLatestBanDate(
        activeBans
      ),

    decoratedBans
  };
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
      activeBans: [],
      latestBanDate: null,
      activeBanDate: null,
      error:
        "STEAMHISTORY_API_KEY is not configured"
    };
  }

  const params =
    new URLSearchParams({
      key: apiKey,
      shouldkey: "1",
      steamids: steamID64
    });

  try {
    const response =
      await fetch(
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
        latestBanDate: null,
        activeBanDate: null,
        error:
          `SteamHistory HTTP ${response.status}`
      };
    }

    let data;

    try {
      data =
        await response.json();
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
        latestBanDate: null,
        activeBanDate: null,
        error:
          "SteamHistory returned invalid JSON"
      };
    }

    const bans =
      data?.response?.[steamID64];

    if (!Array.isArray(bans)) {
      return {
        available: true,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: [],
        latestBanDate: null,
        activeBanDate: null
      };
    }

    const analysis =
      analyzeSourceBans(
        bans
      );

    return {
      available: true,

      banned:
        analysis.banned,

      keywordMatch:
        analysis.keywordMatch,

      matchedKeywords:
        analysis.matchedKeywords,

      latestBanDate:
        analysis.latestBanDate,

      activeBanDate:
        analysis.activeBanDate,

      records:
        analysis.decoratedBans ||
        bans,

      activeBans:
        analysis.activeBans
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
      latestBanDate: null,
      activeBanDate: null,
      error:
        "SteamHistory SourceBans request failed"
    };
  }
}

export default {
  async fetch(request, env) {
    try {
      const url =
        new URL(request.url);

      if (
        request.method !== "GET"
      ) {
        return json(
          {
            found: false,
            error:
              "Method not allowed"
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
          version: 7,
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
        normalizeLookup(
          match[1]
        );

      if (!lookupValue) {
        return json(
          {
            found: false,
            error:
              "Missing Steam ID"
          },
          400
        );
      }

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

      const steamID64 =
        isSteamID64(lookupValue)
          ? lookupValue
          : record?.id || null;

      let steamHistory = null;

      let tf2bd = {
        listed: false,
        classification: null,
        sources: []
      };

      let community = {
        possibleCheater: false,
        keywords: []
      };

      let sourcebans = {
        available: false,
        banned: false,
        keywordMatch: false,
        matchedKeywords: [],
        records: [],
        activeBans: [],
        latestBanDate: null,
        activeBanDate: null,
        error:
          "No SteamID64 available for SourceBans lookup"
      };

      if (steamID64) {
        steamHistory =
          await searchSteamHistory(
            steamID64
          );

        tf2bd =
          normalizeTf2bd(
            steamHistory
          );

        community =
          normalizeCommunity(
            steamHistory
          );

        sourcebans =
          await fetchSourceBans(
            steamID64,
            env?.STEAMHISTORY_API_KEY
          );
      }

      const cheaterMatch =
        Boolean(mcdbResult) ||
        sourcebans.keywordMatch === true ||
        isTf2bdCheater(tf2bd) ||
        community.possibleCheater === true;

      if (mcdbResult) {
        return json({
          ...mcdbResult,
          cheaterMatch,
          tf2bd,
          community,
          steamHistory,
          sourcebans
        });
      }

      return json({
        found: false,
        lookup: lookupValue,
        cheaterMatch,
        tf2bd,
        community,
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
          error:
            "Internal server error"
        },
        500
      );
    }
  }
};
