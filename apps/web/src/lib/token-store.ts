import { and, eq, isNull, sql } from "drizzle-orm";
import { integrations, type Database, type Integration } from "@switchboard/db";
import { decryptJson, encryptJson, getEncryptionKey } from "./crypto";
import { log } from "./log";

/**
 * Encrypted OAuth token storage shared by every provider. A connection is
 * either org-wide (HubSpot: `userId` null) or belongs to one rep (Google
 * Calendar: each rep connects their own calendar). Tokens are decrypted only
 * in memory and re-encrypted on every save.
 */

export type Provider = Integration["provider"];

/** Who a connection belongs to: the org, or one rep inside it. */
export type TokenOwner = { orgId: string; userId: string | null };

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
};

/**
 * The encrypted blob's shape. `expiresAtMs` is epoch milliseconds because
 * JSON round-trips Dates as strings — a Date here would crash the expiry
 * check on load.
 */
type StoredTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  scope?: string;
};

function ownerFilter(provider: Provider, owner: TokenOwner) {
  return and(
    eq(integrations.orgId, owner.orgId),
    eq(integrations.provider, provider),
    owner.userId === null ? isNull(integrations.userId) : eq(integrations.userId, owner.userId),
  );
}

export async function loadTokens(
  db: Database,
  provider: Provider,
  owner: TokenOwner,
): Promise<TokenSet | null> {
  const [row] = await db
    .select({ tokenCipher: integrations.tokenCipher, status: integrations.status })
    .from(integrations)
    .where(ownerFilter(provider, owner))
    .limit(1);
  // A revoked grant can't be refreshed; it waits for a reconnect.
  if (!row || row.status === "revoked") return null;
  try {
    const stored = decryptJson<StoredTokens>(row.tokenCipher, getEncryptionKey());
    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: new Date(stored.expiresAtMs),
      scope: stored.scope,
    };
  } catch (cause) {
    // Unreadable blob: TOKEN_ENCRYPTION_KEY was rotated or lost. Treated as
    // not connected (an admin reconnects and overwrites the row), but logged
    // loudly — silently looking disconnected is a miserable thing to debug.
    log.error(
      `Stored ${provider} tokens could not be decrypted (was TOKEN_ENCRYPTION_KEY changed?): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

export async function saveTokens(
  db: Database,
  provider: Provider,
  owner: TokenOwner,
  tokens: TokenSet,
  accountEmail?: string | null,
): Promise<void> {
  const stored: StoredTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAtMs: tokens.expiresAt.getTime(),
    scope: tokens.scope,
  };
  const tokenCipher = encryptJson(stored, getEncryptionKey());
  const update = {
    tokenCipher,
    scopes: tokens.scope ?? null,
    status: "connected" as const,
    updatedAt: new Date(),
    // A refresh does not re-learn the account; keep the stored one.
    ...(accountEmail !== undefined ? { accountEmail } : {}),
  };
  await db
    .insert(integrations)
    .values({
      orgId: owner.orgId,
      userId: owner.userId,
      provider,
      tokenCipher,
      scopes: tokens.scope ?? null,
      accountEmail: accountEmail ?? null,
      status: "connected",
    })
    .onConflictDoUpdate(
      owner.userId === null
        ? {
            target: [integrations.orgId, integrations.provider],
            targetWhere: sql`${integrations.userId} is null`,
            set: update,
          }
        : {
            target: [integrations.userId, integrations.provider],
            targetWhere: sql`${integrations.userId} is not null`,
            set: update,
          },
    );
}

export async function deleteTokens(
  db: Database,
  provider: Provider,
  owner: TokenOwner,
): Promise<void> {
  await db.delete(integrations).where(ownerFilter(provider, owner));
}

/**
 * A valid access token, refreshing it shortly before expiry (60s skew) and
 * carrying the stored refresh token forward when the provider omits it.
 * Returns null when not connected or the refresh fails — callers degrade
 * instead of failing the request.
 */
export async function getValidAccessToken(
  db: Database,
  provider: Provider,
  owner: TokenOwner,
  refresh: ((refreshToken: string) => Promise<TokenSet>) | null,
): Promise<string | null> {
  const tokens = await loadTokens(db, provider, owner);
  if (!tokens?.refreshToken) return tokens?.accessToken ?? null;
  if (tokens.expiresAt.getTime() - Date.now() > 60_000) return tokens.accessToken;
  if (!refresh) return null;
  try {
    const refreshed = await refresh(tokens.refreshToken);
    const merged: TokenSet = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    };
    await saveTokens(db, provider, owner, merged);
    return merged.accessToken;
  } catch (cause) {
    log.error(
      `${provider} token refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    // The user revoked access (or the grant expired): flag the connection so
    // /integrations asks for a reconnect instead of failing on every request.
    if ((cause as { revoked?: boolean } | null)?.revoked) {
      await db
        .update(integrations)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(ownerFilter(provider, owner));
    }
    return null;
  }
}
