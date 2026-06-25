import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const API_BASE = "https://api.upload-post.com/api";

export type Platform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "pinterest"
  | "google_business";

type PostInput = {
  caption: string;
  title?: string;
  mediaPath: string;
  mediaKind: "image" | "video";
  platforms: Platform[];
  scheduledTime?: Date;
  /** Pinterest only — destination URL for the pin. */
  link?: string;
  /** Pinterest only — board name/id in the connected Pinterest account. */
  pinterestBoard?: string;
  /**
   * Optional cover/thumbnail image for video uploads. Honored by platforms
   * that support custom covers (YouTube, Pinterest pin video, IG Reels via
   * cover_url). TikTok ignores it — TikTok always extracts from frame 0.
   */
  thumbnailPath?: string;
};

function authHeader(): Record<string, string> {
  const key = process.env.UPLOAD_POST_API_KEY;
  if (!key) throw new Error("UPLOAD_POST_API_KEY not set");
  return { Authorization: `Apikey ${key}` };
}

function userProfile(): string {
  const user = process.env.UPLOAD_POST_USER;
  if (!user)
    throw new Error(
      "UPLOAD_POST_USER not set (this is the profile name in your Upload-Post dashboard that has IG + TikTok connected)"
    );
  return user;
}

/**
 * Safety check — verify the Upload-Post profile is connected to the EXPECTED
 * accounts before posting. Prevents the entire-profile-misrouted disaster
 * (e.g. posts intended for @goldtouchlist landing on @mysteryhitsfactory
 * because the OAuth picked the wrong Facebook Page during connection).
 *
 * Set UPLOAD_POST_EXPECTED_HANDLES in .env:
 *   UPLOAD_POST_EXPECTED_HANDLES=instagram:goldtouchlist,tiktok:goldtouchlist,facebook:Gold Touch List
 *
 * Each platform listed is verified against the profile's connected accounts.
 * If a mismatch is found, the run aborts before any post is sent. Platforms
 * not listed in the env are skipped (no constraint).
 */
type ConnectedAccounts = {
  profile?: { username?: string };
  social_accounts?: Record<string, { username?: string; display_name?: string; name?: string } | undefined>;
};

let cachedAccounts: ConnectedAccounts | null = null;

async function getProfileAccounts(): Promise<ConnectedAccounts> {
  if (cachedAccounts) return cachedAccounts;
  const url = `${API_BASE}/uploadposts/users?profile=${encodeURIComponent(userProfile())}`;
  const resp = await fetch(url, { headers: authHeader() });
  if (!resp.ok) {
    throw new Error(`upload-post profile lookup failed: ${resp.status} ${await resp.text()}`);
  }
  cachedAccounts = (await resp.json()) as ConnectedAccounts;
  return cachedAccounts;
}

function parseExpectedHandles(): Map<string, string> {
  const raw = process.env.UPLOAD_POST_EXPECTED_HANDLES;
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const part of raw.split(",")) {
    const [platform, handle] = part.split(":").map((s) => s.trim());
    if (platform && handle) map.set(platform.toLowerCase(), handle.toLowerCase().replace(/^@/, ""));
  }
  return map;
}

const NOT_CONNECTED_SENTINEL = "(no account connected)";

/**
 * Verify the platforms targeted by this post are connected to the expected
 * handles in upload-post.com's profile. Two failure modes:
 *
 *   1. DISCONNECTED — the platform has no account linked at upload-post.com.
 *      We auto-drop that platform from the post and continue with the rest,
 *      matching the existing Facebook-page behavior. The disconnect is loud
 *      enough in the run log that the user knows to reconnect, and the
 *      weekly slot still ships to the other channels.
 *
 *   2. WRONG ACCOUNT — the platform is linked, but to a handle that doesn't
 *      match the expected one. This is dangerous (you'd post to the wrong
 *      brand) so we still hard-fail.
 *
 * Returns the filtered list of platforms that are safe to post.
 */
export async function verifyConnectedAccounts(platforms: Platform[]): Promise<Platform[]> {
  const expected = parseExpectedHandles();
  if (expected.size === 0) {
    // No constraints set — skip silently. User opts in by setting the env.
    return platforms.slice();
  }

  let accounts: ConnectedAccounts;
  try {
    accounts = await getProfileAccounts();
  } catch (err) {
    // If the lookup endpoint shape changed or rate-limited, prefer fail-safe:
    // log a warning but don't block posting. Users can tighten this if they want.
    console.warn(`[upload-post] connected-account verification skipped: ${(err as Error).message}`);
    return platforms.slice();
  }

  const social = accounts.social_accounts ?? {};
  const wrongAccount: string[] = [];
  const disconnected: Platform[] = [];

  for (const platform of platforms) {
    const expectedHandle = expected.get(platform);
    if (!expectedHandle) continue;

    const acct = social[platform];
    const actual =
      acct?.username?.toLowerCase().replace(/^@/, "") ||
      acct?.display_name?.toLowerCase() ||
      acct?.name?.toLowerCase() ||
      NOT_CONNECTED_SENTINEL;

    if (actual === NOT_CONNECTED_SENTINEL) {
      disconnected.push(platform);
    } else if (!actual.includes(expectedHandle)) {
      wrongAccount.push(
        `${platform}: expected "${expectedHandle}", connected to "${actual}"`
      );
    }
  }

  // Wrong-account is still a hard fail — posting to the wrong brand is worse
  // than not posting at all.
  if (wrongAccount.length > 0) {
    throw new Error(
      `ABORT: Upload-Post profile "${userProfile()}" is connected to the WRONG account(s) — refusing to post.\n  ` +
        wrongAccount.join("\n  ") +
        `\nFix: log into upload-post.com → Profiles → ${userProfile()} → reconnect the misrouted account, then retry.`
    );
  }

  // Disconnected platforms get auto-dropped with a loud warning, so the rest
  // of the post still ships.
  const survivors = platforms.filter((p) => !disconnected.includes(p));
  if (disconnected.length > 0) {
    for (const platform of disconnected) {
      const expectedHandle = expected.get(platform);
      console.warn(
        `[upload-post] SKIPPING ${platform} for this post — expected "${expectedHandle}" but no account is connected at upload-post.com.\n` +
          `FIX: upload-post.com → Profiles → ${userProfile()} → reconnect ${platform} (OAuth tokens for ${platform} expire silently; this is the normal failure mode).`
      );
    }
    if (survivors.length === 0) {
      throw new Error(
        `ABORT: every target platform on this post is disconnected at upload-post.com — nothing left to ship. ` +
          `Reconnect at upload-post.com → Profiles → ${userProfile()} and retry.`
      );
    }
  }

  return survivors;
}

export async function postToUploadPost(input: PostInput): Promise<unknown> {
  // Safety net — verify connected accounts. Wrong-account mismatches still
  // hard-fail; disconnected platforms are dropped with a loud warning so
  // the rest of the post ships. No-op when UPLOAD_POST_EXPECTED_HANDLES
  // is unset.
  let platforms = await verifyConnectedAccounts(input.platforms);

  // Pre-flight FB Page routing check. If FB is in the target platforms but
  // the configured FACEBOOK_PAGE_ID isn't in the profile's connected-Page
  // list, the post will fail at FB's auth layer 100% of the time — Upload-
  // Post's `Accessible pages: ...` error is FB itself rejecting the request.
  // We auto-drop FB from the platform list and continue with the others so
  // TikTok/IG/YouTube can still ship while the user fixes the FB OAuth grant.
  if (platforms.includes("facebook")) {
    const pageId = process.env.FACEBOOK_PAGE_ID;
    if (!pageId) {
      // Missing page id can't be posted safely (risk of misrouting), but it
      // must NOT sink the whole post — drop FB and ship everything else.
      console.warn(
        "[upload-post] SKIPPING facebook for this post — FACEBOOK_PAGE_ID is not set. " +
          "It's required to route FB posts to the right Page; the other platforms still post. " +
          "To re-enable Facebook, get the ID from https://api.upload-post.com/api/uploadposts/facebook/pages?profile=" +
          encodeURIComponent(userProfile()) +
          " (or FB Page → About → Page transparency → Page ID) and set it as the FACEBOOK_PAGE_ID secret."
      );
      platforms = platforms.filter((p) => p !== "facebook");
      if (platforms.length === 0) {
        throw new Error(
          "Refusing to post: facebook was the only target platform and FACEBOOK_PAGE_ID is not set (see warning above)."
        );
      }
    } else {
      const reachable = await preflightFacebookPage(pageId);
      if (!reachable) {
        console.warn(
          `[upload-post] SKIPPING facebook for this post — FACEBOOK_PAGE_ID is not in the profile's connected-Page list. ` +
            `See the FB diagnostic above for the exact connected Pages.\n` +
            `FIX (this is at Facebook's level, not Upload-Post's):\n` +
            `  1. Go to https://www.facebook.com/settings?tab=business_tools and click "Remove" on Upload-Post.\n` +
            `  2. Reconnect Facebook on upload-post.com. When FB pops up the auth dialog, click the small "Edit settings" link (or "Choose what you allow") and CHECK the correct Page.\n` +
            `  3. Also set the per-profile default Page at https://app.upload-post.com/manage-users (support's preferred routing control).\n` +
            `  4. Confirm with: curl -H "Authorization: Apikey $UPLOAD_POST_API_KEY" "https://api.upload-post.com/api/uploadposts/facebook/pages?profile=$UPLOAD_POST_USER" — your Page must appear in the list.`
        );
        platforms = platforms.filter((p) => p !== "facebook");
        if (platforms.length === 0) {
          throw new Error(
            "Refusing to post: facebook was the only target platform and its OAuth grant is broken (see warning above)."
          );
        }
      }
    }
  }

  const fileBuf = await readFile(input.mediaPath);
  const fileName = basename(input.mediaPath);
  const blob = new Blob([fileBuf]);

  const form = new FormData();
  form.append("user", userProfile());
  for (const p of platforms) form.append("platform[]", p);
  if (input.scheduledTime) {
    form.append("scheduled_time", input.scheduledTime.toISOString());
  }

  // Belt-and-suspenders FB Page routing. Without this, Upload-Post auto-routes
  // to whichever single Page is OAuth-granted to the profile — and if the user
  // manages multiple Pages on the same FB account (Bloom Roster, Mystery Hits
  // Factory, Gold Touch List, etc.), a stale OAuth grant can silently land
  // posts on the wrong Page. Passing facebook_page_id makes routing explicit.
  if (platforms.includes("facebook")) {
    const pageId = process.env.FACEBOOK_PAGE_ID!; // non-null asserted: checked above
    form.append("facebook_page_id", pageId);
    await logFacebookRoutingDiagnostics(pageId);
  }

  let endpoint: string;
  if (input.mediaKind === "video") {
    endpoint = `${API_BASE}/upload`;
    form.append("video", blob, fileName);
    form.append("title", input.title ?? input.caption.slice(0, 90));
    form.append("description", input.caption);
    if (input.thumbnailPath) {
      const thumbBuf = await readFile(input.thumbnailPath);
      const thumbBlob = new Blob([thumbBuf]);
      // Upload-Post accepts `thumbnail` for YouTube; some accounts also
      // map `cover` → IG Reels cover_url. Send under both for forward-compat.
      form.append("thumbnail", thumbBlob, basename(input.thumbnailPath));
      form.append("cover", thumbBlob, basename(input.thumbnailPath));
    }
  } else {
    endpoint = `${API_BASE}/upload_photos`;
    form.append("photos[]", blob, fileName);
    form.append("caption", input.caption);
    form.append("title", input.title ?? input.caption.slice(0, 90));
    // Pinterest-specific fields. Upload-Post's photo endpoint accepts these
    // and routes them through for the pinterest platform; other platforms
    // ignore them.
    if (input.link) form.append("link", input.link);
    const board = input.pinterestBoard ?? process.env.PINTEREST_BOARD;
    if (platforms.includes("pinterest")) {
      if (!board) {
        throw new Error(
          "Pinterest board not set — add PINTEREST_BOARD env var (or pass pinterestBoard) with the board ID/name from your Upload-Post Pinterest connection."
        );
      }
      // Upload-Post expects pinterest_board_id (the field is documented under
      // that name on their API). Send it under both keys for forward-compat.
      form.append("pinterest_board_id", board);
      form.append("pinterest_board", board);
    }
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: authHeader(),
    body: form,
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`upload-post ${input.mediaKind} post failed: ${resp.status} ${bodyText}`);
  }

  if (platforms.includes("facebook")) {
    console.log(`[upload-post] FB-targeted post response (${input.mediaKind}):\n${bodyText}`);
  }

  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }

  // Detect per-platform failures even when HTTP returns 200. Upload-Post's
  // envelope often says success:true while every platform inside fails —
  // common shapes:
  //   { success: true, status: "failed", results: { facebook: { success: false, error: "..." }, instagram: {...} } }
  //   { facebook: { status: "failed", error: "..." }, instagram: {...} }
  // We separate soft failures (rate limits — routine, don't redden the
  // workflow) from hard failures (auth, page-grant, validation — must
  // surface). Soft-only failures log a warning and return successfully so
  // the other platforms that DID post don't get penalized.
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const softFailed: string[] = [];
    const hardFailed: string[] = [];

    const inspectPlatform = (platform: string, raw: unknown): void => {
      if (!raw || typeof raw !== "object") return;
      const r = raw as Record<string, unknown>;
      const status = String(r.status ?? r.state ?? "").toLowerCase();
      const error = r.error ?? r.message ?? r.error_message;
      const platformSuccess = r.success;
      const failed =
        platformSuccess === false ||
        error ||
        status === "failed" ||
        status === "error" ||
        status === "rejected";
      if (!failed) return;
      const msg = `${platform}: ${typeof error === "string" ? error : status || "unknown error"}`;
      if (isSoftFailure(typeof error === "string" ? error : status)) {
        softFailed.push(msg);
      } else {
        hardFailed.push(msg);
      }
    };

    // Walk both shapes: top-level platform keys, and nested under `results`.
    const results = (obj.results ?? null) as Record<string, unknown> | null;
    for (const platform of platforms) {
      inspectPlatform(platform, obj[platform]);
      if (results && typeof results === "object") {
        inspectPlatform(platform, results[platform]);
      }
    }

    // Generic top-level failure signal — only treated as hard if no per-
    // platform classification covered it (avoids double-counting).
    const topStatus = String(obj.status ?? "").toLowerCase();
    const topError = obj.error ?? obj.errors;
    if (
      softFailed.length === 0 &&
      hardFailed.length === 0 &&
      (topStatus === "failed" || topStatus === "error" || topError)
    ) {
      const msg = `overall: ${typeof topError === "string" ? topError : topStatus || "failed"}`;
      if (isSoftFailure(typeof topError === "string" ? topError : topStatus)) {
        softFailed.push(msg);
      } else {
        hardFailed.push(msg);
      }
    }

    if (softFailed.length > 0) {
      console.warn(
        `[upload-post] soft failures (continuing — other platforms still posted):\n  ${softFailed.join("\n  ")}`
      );
    }

    if (hardFailed.length > 0) {
      throw new Error(
        `upload-post returned HTTP 200 but one or more platforms failed:\n  ${hardFailed.join("\n  ")}\n` +
          (softFailed.length > 0
            ? `Soft failures (informational): ${softFailed.join("; ")}\n`
            : "") +
          `Full response logged above. If the error mentions "access token" or "session has been invalidated", reconnect Facebook in upload-post.com — IG is linked through that FB session so both will be restored.`
      );
    }
  }

  return body;
}

/**
 * Classify a platform error message as a "soft" failure (routine, transient,
 * shouldn't redden the workflow) vs a hard failure that needs attention.
 * Soft = rate limits / throttling / quotas — the other platforms in the
 * same multi-platform call already posted successfully, so failing the
 * whole slot would cause more harm than good.
 */
function isSoftFailure(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("rate limit") ||
    t.includes("rate-limit") ||
    t.includes("rate_limit") ||
    t.includes("too many requests") ||
    t.includes("throttle") ||
    t.includes("throttled") ||
    t.includes("quota") ||
    t.includes("daily limit") ||
    t.includes("daily_limit") ||
    t.includes("429") ||
    t.includes("try again later")
  );
}

type FbPage = {
  id?: string;
  page_id?: string;
  name?: string;
  display_name?: string;
};

let cachedFbPages: FbPage[] | null = null;

async function listFacebookPages(): Promise<FbPage[]> {
  if (cachedFbPages) return cachedFbPages;
  const url = `${API_BASE}/uploadposts/facebook/pages?profile=${encodeURIComponent(userProfile())}`;
  const resp = await fetch(url, { headers: authHeader() });
  if (!resp.ok) {
    throw new Error(`pages lookup ${resp.status}: ${await resp.text()}`);
  }
  const json = (await resp.json()) as { pages?: FbPage[] } | FbPage[];
  cachedFbPages = Array.isArray(json) ? json : (json.pages ?? []);
  return cachedFbPages;
}

function maskId(id: string): string {
  if (id.length <= 4) return "****";
  return `****${id.slice(-4)}`;
}

/**
 * Pre-flight reachability check. Returns true if the configured page id
 * appears in the Upload-Post profile's connected-Page list, false otherwise.
 * Returns true on lookup failure (network blip / endpoint change) so we
 * don't block posts when the diagnostic itself is broken — the silent-
 * failure detector still catches anything that fails downstream.
 */
async function preflightFacebookPage(configuredPageId: string): Promise<boolean> {
  try {
    const pages = await listFacebookPages();
    if (pages.length === 0) return true; // can't prove negative, let it through
    return pages.some((p) => (p.id ?? p.page_id) === configuredPageId);
  } catch {
    return true; // fail-open on lookup error
  }
}

async function logFacebookRoutingDiagnostics(configuredPageId: string): Promise<void> {
  try {
    // Also print which FB account / IG account is currently OAuth'd to this
    // profile. If the user thinks they're posting as Gold Touch List but
    // the connected FB user is "Dan ASAP-Garage-Door", this surfaces it
    // immediately — without this you only learn "1 Page connected" but
    // not WHICH FB user owns that Page grant.
    try {
      const accounts = await getProfileAccounts();
      const fb = accounts.social_accounts?.facebook;
      const ig = accounts.social_accounts?.instagram;
      const fbId =
        fb?.username ?? fb?.display_name ?? fb?.name ?? "(no FB account connected)";
      const igId =
        ig?.username ?? ig?.display_name ?? ig?.name ?? "(no IG account connected)";
      console.log(
        `[upload-post] profile "${userProfile()}" connected as — FB: ${fbId} | IG: ${igId}`
      );
    } catch (err) {
      console.warn(`[upload-post] could not read connected identities: ${(err as Error).message}`);
    }

    const pages = await listFacebookPages();
    console.log(
      `[upload-post] FB routing: sending facebook_page_id=${maskId(configuredPageId)} (len=${configuredPageId.length})`
    );
    if (pages.length === 0) {
      console.warn(
        `[upload-post] WARNING: /uploadposts/facebook/pages returned 0 pages for profile "${userProfile()}" — the OAuth grant on this profile may be empty or scoped wrong`
      );
      return;
    }
    console.log(`[upload-post] profile "${userProfile()}" has ${pages.length} FB Page(s) connected:`);
    let matched = false;
    for (const p of pages) {
      const pid = p.id ?? p.page_id ?? "";
      const pname = p.name ?? p.display_name ?? "(unnamed)";
      const isMatch = pid === configuredPageId;
      if (isMatch) matched = true;
      console.log(
        `  - ${pname} [${maskId(pid)} len=${pid.length}]${isMatch ? "  ← matches FACEBOOK_PAGE_ID" : ""}`
      );
    }
    if (!matched) {
      console.warn(
        `[upload-post] WARNING: FACEBOOK_PAGE_ID does not match ANY connected Page on this profile — Upload-Post will likely silently fall back to its default Page, which is how cross-business misrouting happens. Verify the secret value matches one of the IDs above.`
      );
    }
  } catch (err) {
    console.warn(`[upload-post] FB routing diagnostic skipped: ${(err as Error).message}`);
  }
}
