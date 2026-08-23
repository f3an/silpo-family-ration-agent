import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { DbService } from '../db/db.service';

export interface FamilyMemberInfo {
  accountId: string;
  name: string | null;
  phone: string | null;
  itsMe: boolean;
}

export interface FamilyInfo {
  familyId: string | null;
  members: FamilyMemberInfo[];
}

interface SilpoFamilyMember {
  profileId?: string;
  name?: string | null;
  phone?: string | null;
  itsMe?: boolean;
}

interface SilpoFamilyResult {
  name?: string | null;
  members?: SilpoFamilyMember[];
}

/**
 * Groups Silpo accounts into family units for shared family chats (see
 * agent.service.ts sendFamilyMessage/listFamilyChats/etc.) — no MCP tool
 * links separate accounts directly, so `sync()` is the only source of
 * truth: it reads `silpo_get_my_family`, whose member list's `profileId`
 * IS each member's own Silpo account id (confirmed live — a member's
 * `profileId` equals what `silpo_get_my_profile().profile.id` returns for
 * that same person when THEY log in). "юзер1 реєструється → family entity;
 * юзер2 реєструється → вже відомо, що він в сім'ї юзера1": the first
 * account to sync registers EVERY member Silpo lists (including ones who
 * haven't logged into this agent yet), so a later login from any of them
 * just finds their account_id already linked.
 */
@Injectable()
export class FamilyStore {
  constructor(private readonly db: DbService) {}

  async getFamilyIdForAccount(accountId: string): Promise<string | undefined> {
    const { rows } = await this.db.query<{ family_id: string }>(
      'SELECT family_id FROM family_members WHERE account_id = $1',
      [accountId],
    );
    return rows[0]?.family_id;
  }

  async listMemberAccountIds(familyId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ account_id: string }>(
      'SELECT account_id FROM family_members WHERE family_id = $1',
      [familyId],
    );
    return rows.map((r) => r.account_id);
  }

  private async createFamily(silpoName: string | null): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      'INSERT INTO families (id, silpo_name) VALUES ($1, $2)',
      [id, silpoName],
    );
    return id;
  }

  private async addMember(familyId: string, accountId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO family_members (account_id, family_id) VALUES ($1, $2)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, familyId],
    );
  }

  /**
   * Idempotent — safe to call on every `GET /agent/family`, not just once:
   * re-adding an already-linked member is a no-op, and a member Silpo added
   * later just joins the existing group on the next sync. Returns
   * `familyId: null` for a solo account (fewer than 2 Silpo family
   * members) — we don't create a family-of-one.
   */
  async sync(mcp: Client, accountId: string): Promise<FamilyInfo> {
    const result = await mcp.callTool({
      name: 'silpo_get_my_family',
      arguments: {},
    });
    const family = result.structuredContent as SilpoFamilyResult | undefined;
    const members = (family?.members ?? []).filter(
      (m): m is SilpoFamilyMember & { profileId: string } =>
        Boolean(m.profileId),
    );

    if (members.length < 2) {
      return { familyId: null, members: [] };
    }

    let familyId = await this.getFamilyIdForAccount(accountId);
    if (!familyId) {
      for (const m of members) {
        if (m.profileId === accountId) continue;
        const existing = await this.getFamilyIdForAccount(m.profileId);
        if (existing) {
          familyId = existing;
          break;
        }
      }
    }
    if (!familyId) {
      familyId = await this.createFamily(family?.name ?? null);
    }

    await Promise.all(
      members.map((m) => this.addMember(familyId, m.profileId)),
    );

    return {
      familyId,
      members: members.map((m) => ({
        accountId: m.profileId,
        name: m.name ?? null,
        phone: m.phone ?? null,
        itsMe: m.itsMe ?? m.profileId === accountId,
      })),
    };
  }
}
