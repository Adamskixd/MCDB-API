<h2 data-importer="text" align="left">Hi 👋!</h2>

<h2 data-importer="text" align="left">CheaterList</h2>

<h5 data-importer="text" align="left">List of TF2 players that were identified through known-cheater Steam groups and other sources.<br><br>We query the Steam API to collect Steam IDs from these groups, then perform ID conversions, duplicate checks, normalization, and database processing before publishing the data to the lookup system.</h5>

<h2 align="left">Detection Pipeline</h2>
The project uses a layered lookup pipeline so the client does not need to download the entire database.
```text
Player
   ↓
SteamID
   ↓
MCDB lookup
   ↓
SteamHistory lookup
   ↓
SourceBans check
   ↓
Keyword scan
   ↓
cheaterMatch
   ↓
Lua ESP
```

<h3 align="left">How the pipeline works</h3>
1. Player → SteamID<br>
The TF2 Lua script detects players currently connected to the server and obtains their Steam ID information. SteamID64 is used as the primary identifier because it is stable and can be used to perform the external lookups.
<br><br>
2. SteamID → MCDB lookup<br>
The SteamID is sent to the MCDB Cloudflare Worker. MCDB is split into static lookup shards, allowing the Worker to retrieve the relevant record without downloading the entire database. The manual test database is also checked first so new entries can be tested immediately.
<br><br>
3. MCDB → SteamHistory lookup<br>
For a resolved SteamID64, the Worker can query SteamHistory to locate the corresponding SteamHistory profile/data. This gives the system another source of information without requiring the Lua client to communicate with multiple external services directly.
<br><br>
4. SteamHistory → SourceBans check<br>
The Worker checks SourceBans information associated with the SteamID64. SourceBans records can contain ban information and descriptive fields collected from Source engine servers.
<br><br>
5. SourceBans → Keyword scan<br>
The returned SourceBans data is scanned for configured keywords such as:
```text
cheat
cheats
aimbot
hack
stac
multihack
```
The keyword scan is case-insensitive. When a configured keyword is found in the relevant SourceBans keyword data, the Worker sets <code>keywordMatch</code> to <code>true</code> and records which keywords matched.
<br><br>
6. Keyword scan → cheaterMatch<br>
The Worker combines the available signals into a single <code>cheaterMatch</code> value. A positive match can come from the MCDB database or from a SourceBans keyword match. This keeps the Lua side simple: it only needs to consume the API result rather than reproduce the lookup logic.
<br><br>
7. cheaterMatch → Lua ESP<br>
When <code>cheaterMatch</code> is true, the TF2 Lua script stores the player's SteamID64 as a match and draws the <code>CHEATER</code> indicator in the ESP when the player is eligible to be rendered.
The ESP also performs additional checks so the label follows the local ESP state instead of becoming a stale marker:
Enemy Only is respected.
Dormant players are ignored.
A maximum ESP distance is enforced.
Invalid or dead entities are ignored.
The label is projected from the player's current position.

<h2 align="left">Why the system is robust</h2>
The project is designed as a layered system rather than relying on a single database lookup.
Multiple identification formats<br>
The Worker accepts SteamID64, SteamID1, and Steam3 identifiers. This makes the API flexible when data comes from different Steam/TF2 sources.
<br><br>
Sharded database<br>
The MCDB dataset is divided into lookup shards. SteamID64 requests can select the relevant shard directly, keeping individual requests small and fast.
<br><br>
Manual test database<br>
A separate <code>manual_test.json</code> file makes it possible to add and verify entries without modifying the main dataset first.
<br><br>
External corroboration<br>
MCDB and SteamHistory/SourceBans provide separate sources of information. The system can therefore detect a player through an existing MCDB record or through SourceBans keyword evidence.
<br><br>
Failure handling<br>
The Worker is designed to handle failed fetches and invalid JSON without crashing the entire API request. Responses use no-cache headers so stale Worker-side API data is not intentionally retained.
<br><br>
Client-side safeguards<br>
The Lua script caches checked SteamIDs so the same player is not repeatedly queried, ignores bots/HLTV clients, clears state when the server changes, and only displays the ESP label when the target passes the visibility/range/team-state checks.
<br><br>
Important limitation<br>
This project is a detection and correlation system, not a mathematical proof that a player is cheating. A database match or SourceBans record is evidence that the Steam account appears in the configured data sources; the system should be treated as a high-signal lookup tool rather than an absolute determination of player behavior.

<div data-importer="stats" align="center">
  <img src="https://raw.githubusercontent.com/Adamskixd/Adamskixd/stats-output/stats.svg?hide_title=false&hide_rank=false&show_icons=true&include_all_commits=true&count_private=true&disable_animations=false&theme=dracula&locale=en&hide_border=false" height="150" alt="stats graph"  />
  <img src="https://raw.githubusercontent.com/Adamskixd/Adamskixd/languages-output/languages.svg?locale=en&hide_title=false&layout=compact&card_width=320&langs_count=5&theme=dracula&hide_border=false" height="150" alt="languages graph"  />
</div>

<div data-importer="techs" align="left">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" height="30" alt="javascript logo"  />
  <img width="12" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" height="30" alt="typescript logo"  />
  <img width="12" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/css3/css3-original.svg" height="30" alt="css3 logo"  />
  <img width="12" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" height="30" alt="python logo"  />
  <img width="12" />
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/csharp/csharp-original.svg" height="30" alt="csharp logo"  />
</div>

<div data-importer="socials" align="left">
  <img src="https://img.shields.io/static/v1?message=Youtube&logo=youtube&label=&color=FF0000&logoColor=white&labelColor=&style=for-the-badge" height="35" alt="youtube logo"  />
  <img src="https://img.shields.io/static/v1?message=Discord&logo=discord&label=&color=7289DA&logoColor=white&labelColor=&style=for-the-badge" height="35" alt="discord logo"  />
</div>

<br clear="both">


<div data-importer="border">
  <img style="100%" src="https://capsule-render.vercel.app/api?type=waving&height=100&section=header&reversal=false&fontSize=70&fontColor=FFFFFF&fontAlign=50&fontAlignY=50&stroke=-&descSize=20&descAlign=50&descAlignY=50&theme=cobalt"  />
</div>
