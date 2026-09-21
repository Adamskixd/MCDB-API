/**
 * MCDB lookup API
 *
 * Deploy this as a Cloudflare Worker.
 *
 * Database:
 *   data/shards/00.json
 *   data/shards/01.json
 *   ...
 *   data/shards/ff.json
 *
 * Additional manual testing database:
 *   data/manual_test.json
 *
 * Example:
 *   GET /lookup/76561199291189951
 *   GET /lookup/STEAM_1:1:665462111
 *   GET /lookup/[U:1:1330924223]
 */

const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/shards";

const MANUAL_TEST_URL =
  "https://raw.githubusercontent.com/Adamskixd/MCDB-API/main/data/manual_test.json";


export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    /*
     * Health check
     */
    if (parts.length === 0 || parts[0] === "health") {
      return json({
        ok: true,
        service: "mcdb-api",
        version: 2
      });
    }

    /*
     * Validate lookup request
     */
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
     * ========================================================
     * SteamID64 lookup
     * ========================================================
     *
     * SteamID64 is 17 digits.
     *
     * The final two characters determine the shard.
     *
     * Example:
     *
     * 76561199081282611
     *                 ^^
     *                 11.json
     */
    if (/^\d{17}$/.test(identifier)) {
      const shard = identifier
        .slice(-2)
        .toLowerCase();

      const [shardData, manualData] =
        await Promise.all([
          fetchShard(shard),
          fetchManualTest()
        ]);

      /*
       * Check the normal database first.
       */
      let player =
        shardData &&
        (
          shardData[identifier] ||
          shardData[identifier.toLowerCase()]
        );

      /*
       * If not found, check manual_test.json.
       */
      if (!player && manualData) {
        player =
          manualData[identifier] ||
          manualData[identifier.toLowerCase()];
      }

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


    /*
     * ========================================================
     * SteamID1 / Steam3 lookup
     * ========================================================
     *
     * These identifiers don't contain the SteamID64 shard,
     * so we search all 256 shards.
     *
     * manual_test.json is searched as well.
     */

    const shards = [];

    for (let i = 0; i < 256; i++) {
      shards.push(
        i.toString(16).padStart(2, "0")
      );
    }

    /*
     * Fetch manual database and all shards concurrently.
     */
    const results = await Promise.all([
      fetchManualTest(),

      ...shards.map((shard) =>
        fetchShard(shard)
      )
    ]);


    /*
     * Search each database for the identifier.
     */
    const player = results
      .map((data) => {
        if (!data) {
          return null;
        }

        return (
          data[identifier] ||
          data[identifier.toLowerCase()] ||
          null
        );
      })
      .find(Boolean);


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
 * ============================================================
 * Fetch a normal shard
 * ============================================================
 *
 * No Cloudflare cache.
 * No API cache.
 *
 * A timestamp is added to the URL so that every request gets
 * a unique GitHub URL.
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
 * ============================================================
 * Fetch manual testing database
 * ============================================================
 *
 * File:
 *
 * data/manual_test.json
 *
 * This database is searched in addition to the normal shards.
 */
async function fetchManualTest() {
  const cacheBuster = Date.now();

  const response = await fetch(
    `${MANUAL_TEST_URL}?nocache=${cacheBuster}`,
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
 * ============================================================
 * JSON response helper
 * ============================================================
 *
 * API responses are not cached.
 */
function json(value, status = 200) {
  return new Response(
    JSON.stringify(value),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store, no-cache, must-revalidate, max-age=0",

        "pragma": "no-cache",

        "expires": "0"
      }
    }
  );
}
