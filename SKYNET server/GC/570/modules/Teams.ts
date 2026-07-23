import { DotaTeam, DotaTeamMember, DotaTeamUpsert, RawMessageContext, gc } from "../framework/gc";
import {
    CMsgDOTACreateTeam,
    CMsgDOTACreateTeamResponse,
    CMsgDOTACreateTeamResponse_Result,
    CMsgDOTAEditTeamDetails,
    CMsgDOTAEditTeamDetailsResponse,
    CMsgDOTAEditTeamDetailsResponse_Result,
    CMsgDOTAKickTeamMember,
    CMsgDOTAKickTeamMemberResponse,
    CMsgDOTAKickTeamMemberResponse_Result,
    CMsgDOTATeamInviteGCImmediateResponseToInviter,
    CMsgDOTATeamInviteGCRequestToInvitee,
    CMsgDOTATeamInviteGCResponseToInvitee,
    CMsgDOTATeamInviteGCResponseToInviter,
    CMsgDOTATeamInviteInviteeResponseToGC,
    CMsgDOTATeamInviteInviterToGC,
    CMsgDOTATransferTeamAdmin,
    CMsgDOTATransferTeamAdminResponse,
    CMsgDOTATransferTeamAdminResponse_Result,
    CMsgGCPlayerInfoSubmit,
    CMsgGCPlayerInfoSubmitResponse,
    CMsgGCPlayerInfoSubmitResponse_EResult,
    CMsgGCRankedPlayerInfoSubmit,
    CMsgGCRankedPlayerInfoSubmitResponse,
    CMsgGCRankedPlayerInfoSubmitResponse_EResult,
    CMsgResponseTeamFanfare,
    CMsgTeamFanfare,
    ETeamInviteResult,
    Msg,
    Proto
} from "../generated/dota";

const TEAM_ROLE_MEMBER = 0;
const TEAM_ROLE_ADMIN = 1;
const TEAM_MEMBER_LIMIT = 5;

interface PendingTeamInvite {
    inviterAccountId: number;
    inviterSteamId: bigint;
    targetAccountId: number;
    teamId: number;
    teamName: string;
}

const pendingInvites: PendingTeamInvite[] = [];

export function registerTeams(): void {
    const teams = new Teams();
    teams.register();
}

export class Teams {
    register(): void {
        gc.onMessage(Msg.GCCreateTeam, (ctx) => this.createTeam(ctx));
        gc.onMessage(Msg.GCEditTeamDetails, (ctx) => this.editTeam(ctx));
        gc.onMessage(Msg.GCTeamInviteInviterToGC, (ctx) => this.invite(ctx));
        gc.onMessage(Msg.GCTeamInviteInviteeResponseToGC, (ctx) => this.inviteResponse(ctx));
        gc.onMessage(Msg.GCKickTeamMember, (ctx) => this.kickMember(ctx));
        gc.onMessage(Msg.GCTransferTeamAdmin, (ctx) => this.transferAdmin(ctx));
        gc.onMessage(Msg.TeamFanfare, (ctx) => this.teamFanfare(ctx));
        gc.onMessage(Msg.GCRankedPlayerInfoSubmit, (ctx) => this.rankedPlayerInfo(ctx));
        gc.onMessage(Msg.GCPlayerInfoSubmit, (ctx) => this.playerInfoSubmit(ctx));
    }

    private createTeam(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgDOTACreateTeam) as CMsgDOTACreateTeam;
        let result = validateCreateTeam(ctx, request);
        let teamId = 0;

        if (result === CMsgDOTACreateTeamResponse_Result.Success) {
            teamId = ctx.services.teams.nextTeamId();
            const team = ctx.services.teams.upsert(toTeamUpsert(teamId, request));
            if (team === null || !ctx.services.teams.addMember(teamId, ctx.accountId, TEAM_ROLE_ADMIN)) {
                result = CMsgDOTACreateTeamResponse_Result.UnspecifiedError;
                teamId = 0;
            }
        }

        ctx.reply<CMsgDOTACreateTeamResponse>(Msg.GCCreateTeamResponse, Proto.CMsgDOTACreateTeamResponse, {
            result,
            teamId
        });
        return true;
    }

    private editTeam(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgDOTAEditTeamDetails) as CMsgDOTAEditTeamDetails;
        const teamId = request.teamId ?? 0;
        const team = ctx.services.teams.get(teamId);
        let result: number = CMsgDOTAEditTeamDetailsResponse_Result.FailureUnspecifiedError;

        if (team !== null) {
            if (isAdmin(team, ctx.accountId) && hasText(request.name) && hasText(request.tag)) {
                ctx.services.teams.upsert(toTeamUpsert(teamId, request, team));
                result = CMsgDOTAEditTeamDetailsResponse_Result.Success;
            } else if (!isMember(team, ctx.accountId)) {
                result = CMsgDOTAEditTeamDetailsResponse_Result.FailureNotMember;
            }
        }

        ctx.reply<CMsgDOTAEditTeamDetailsResponse>(
            Msg.GCEditTeamDetailsResponse,
            Proto.CMsgDOTAEditTeamDetailsResponse,
            { result }
        );
        return true;
    }

    private invite(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgDOTATeamInviteInviterToGC) as CMsgDOTATeamInviteInviterToGC;
        const team = ctx.services.teams.get(request.teamId ?? 0);
        let result: number = ETeamInviteResult.TeamInviteErrorUnspecified;
        let inviteeName = "";

        if (team === null) {
            // leave default error
        } else if (!isAdmin(team, ctx.accountId)) {
            result = ETeamInviteResult.TeamInviteErrorInviterNotAdmin;
        } else if (isMember(team, request.accountId === undefined ? 0 : request.accountId)) {
            result = ETeamInviteResult.TeamInviteErrorInviteeAlreadyMember;
        } else if (teamMembers(team).length >= TEAM_MEMBER_LIMIT) {
            result = ETeamInviteResult.TeamInviteErrorTeamAtMemberLimit;
        } else if (pendingInviteFor(request.accountId === undefined ? 0 : request.accountId) !== null) {
            result = ETeamInviteResult.TeamInviteErrorInviteeBusy;
        } else {
            const targetAccount = request.accountId ?? 0;
            const accountName = ctx.services.stats.lookupAccountName(targetAccount).accountName;
            inviteeName = accountName;
            // Team invites are an ephemeral GC handshake: the inviter gets 7123 immediately,
            // the invitee receives 7124 by SteamID, and the later invitee response drives 7126/7127.
            pendingInvites.push({
                inviterAccountId: ctx.accountId,
                inviterSteamId: ctx.steamId,
                targetAccountId: targetAccount,
                teamId: team.teamId,
                teamName: team.name
            });
            queueToSteam<CMsgDOTATeamInviteGCRequestToInvitee>(
                ctx,
                steamIdFromAccountId(targetAccount),
                Msg.GCTeamInviteGCRequestToInvitee,
                Proto.CMsgDOTATeamInviteGCRequestToInvitee,
                {
                    inviterAccountId: ctx.accountId,
                    teamName: team.name,
                    teamTag: team.tag,
                    logo: team.logo
                }
            );
            result = ETeamInviteResult.TeamInviteSuccess;
        }

        ctx.reply<CMsgDOTATeamInviteGCImmediateResponseToInviter>(
            Msg.GCTeamInviteGCImmediateResponseToInviter,
            Proto.CMsgDOTATeamInviteGCImmediateResponseToInviter,
            { result, inviteeName }
        );
        return true;
    }

    private inviteResponse(ctx: RawMessageContext): boolean {
        const request = ctx.decode(
            Proto.CMsgDOTATeamInviteInviteeResponseToGC
        ) as CMsgDOTATeamInviteInviteeResponseToGC;
        const invite = takePendingInvite(ctx.accountId);
        const result = request.result ?? ETeamInviteResult.TeamInviteFailureInviteRejected;
        if (invite === null) {
            ctx.reply<CMsgDOTATeamInviteGCResponseToInvitee>(
                Msg.GCTeamInviteGCResponseToInvitee,
                Proto.CMsgDOTATeamInviteGCResponseToInvitee,
                { result: ETeamInviteResult.TeamInviteErrorUnspecified }
            );
            return true;
        }

        if (result === ETeamInviteResult.TeamInviteSuccess) {
            ctx.services.teams.addMember(invite.teamId, ctx.accountId, TEAM_ROLE_MEMBER);
        }

        ctx.reply<CMsgDOTATeamInviteGCResponseToInvitee>(
            Msg.GCTeamInviteGCResponseToInvitee,
            Proto.CMsgDOTATeamInviteGCResponseToInvitee,
            { result, teamName: invite.teamName }
        );
        queueToSteam<CMsgDOTATeamInviteGCResponseToInviter>(
            ctx,
            invite.inviterSteamId,
            Msg.GCTeamInviteGCResponseToInviter,
            Proto.CMsgDOTATeamInviteGCResponseToInviter,
            { result, inviteeName: ctx.personaName }
        );
        return true;
    }

    private kickMember(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgDOTAKickTeamMember) as CMsgDOTAKickTeamMember;
        const team = ctx.services.teams.get(request.teamId ?? 0);
        let result: number = CMsgDOTAKickTeamMemberResponse_Result.FailureUnspecifiedError;

        if (team === null) {
            // leave default error
        } else if (!isAdmin(team, ctx.accountId)) {
            result = CMsgDOTAKickTeamMemberResponse_Result.FailureKickerNotAdmin;
        } else if (!isMember(team, request.accountId === undefined ? 0 : request.accountId)) {
            result = CMsgDOTAKickTeamMemberResponse_Result.FailureKickeeNotMember;
        } else {
            ctx.services.teams.removeMember(team.teamId, request.accountId === undefined ? 0 : request.accountId);
            ctx.services.teams.deletePlayerInfo(request.accountId === undefined ? 0 : request.accountId);
            result = CMsgDOTAKickTeamMemberResponse_Result.Success;
        }

        ctx.reply<CMsgDOTAKickTeamMemberResponse>(Msg.GCKickTeamMemberResponse, Proto.CMsgDOTAKickTeamMemberResponse, {
            result
        });
        return true;
    }

    private transferAdmin(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgDOTATransferTeamAdmin) as CMsgDOTATransferTeamAdmin;
        const team = ctx.services.teams.get(request.teamId ?? 0);
        const newAdminAccountId = request.newAdminAccountId ?? 0;
        let result: number = CMsgDOTATransferTeamAdminResponse_Result.FailureUnspecifiedError;

        if (team === null) {
            // leave default error
        } else if (!isAdmin(team, ctx.accountId)) {
            result = CMsgDOTATransferTeamAdminResponse_Result.FailureNotAdmin;
        } else if (newAdminAccountId === ctx.accountId) {
            result = CMsgDOTATransferTeamAdminResponse_Result.FailureSameAccount;
        } else if (!isMember(team, newAdminAccountId)) {
            result = CMsgDOTATransferTeamAdminResponse_Result.FailureNotMember;
        } else {
            const members = teamMembers(team);
            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                ctx.services.teams.addMember(
                    team.teamId,
                    member.accountId,
                    member.accountId === newAdminAccountId ? TEAM_ROLE_ADMIN : TEAM_ROLE_MEMBER
                );
            }
            result = CMsgDOTATransferTeamAdminResponse_Result.Success;
        }

        ctx.reply<CMsgDOTATransferTeamAdminResponse>(
            Msg.GCTransferTeamAdminResponse,
            Proto.CMsgDOTATransferTeamAdminResponse,
            { result }
        );
        return true;
    }

    private teamFanfare(ctx: RawMessageContext): boolean {
        ctx.decode(Proto.CMsgTeamFanfare) as CMsgTeamFanfare;
        ctx.reply<CMsgResponseTeamFanfare>(Msg.ResponseTeamFanfare, Proto.CMsgResponseTeamFanfare, {
            fanfareGoodguys: 0,
            fanfareBadguys: 0
        });
        return true;
    }

    private rankedPlayerInfo(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgGCRankedPlayerInfoSubmit) as CMsgGCRankedPlayerInfoSubmit;
        const info = ctx.services.teams.getPlayerInfo(ctx.accountId);
        // Current protos split the old player-info flow: 7454 updates ranked display name,
        // while 7456 persists the complete team/player metadata used by profile UIs.
        ctx.services.teams.savePlayerInfo({
            accountId: ctx.accountId,
            name: info?.name ?? request.name ?? ctx.personaName,
            countryCode: info?.countryCode ?? "",
            fantasyRole: info?.fantasyRole ?? 0,
            teamId: info?.teamId ?? 0,
            sponsor: info?.sponsor ?? "",
            realName: info?.realName ?? ""
        });
        ctx.reply<CMsgGCRankedPlayerInfoSubmitResponse>(
            Msg.GCRankedPlayerInfoSubmitResponse,
            Proto.CMsgGCRankedPlayerInfoSubmitResponse,
            { result: CMsgGCRankedPlayerInfoSubmitResponse_EResult.Success }
        );
        return true;
    }

    private playerInfoSubmit(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgGCPlayerInfoSubmit) as CMsgGCPlayerInfoSubmit;
        const teamId = request.teamId ?? 0;
        const team = teamId === 0 ? null : ctx.services.teams.get(teamId);
        let result: number = CMsgGCPlayerInfoSubmitResponse_EResult.Success;

        let notMember = false;
        if (teamId !== 0) {
            if (team === null) {
                notMember = true;
            } else if (!isMember(team, ctx.accountId)) {
                notMember = true;
            }
        }
        if (notMember) {
            result = CMsgGCPlayerInfoSubmitResponse_EResult.ErrorNotMemberOfTeam;
        } else {
            ctx.services.teams.savePlayerInfo({
                accountId: ctx.accountId,
                name: request.playerName ?? ctx.personaName,
                countryCode: request.countryCode ?? "",
                fantasyRole: request.fantasyRole ?? 0,
                teamId,
                sponsor: request.sponsor ?? "",
                realName: request.realName ?? ""
            });
        }

        ctx.reply<CMsgGCPlayerInfoSubmitResponse>(
            Msg.GCPlayerInfoSubmitResponse,
            Proto.CMsgGCPlayerInfoSubmitResponse,
            { result }
        );
        return true;
    }
}

function validateCreateTeam(ctx: RawMessageContext, request: CMsgDOTACreateTeam): number {
    const name = request.name ?? "";
    const tag = request.tag ?? "";
    if (ctx.services.teams.getForAccount(ctx.accountId).length > 0) {
        return CMsgDOTACreateTeamResponse_Result.CreatorTeamLimitReached;
    }
    if (!hasText(name)) {
        return CMsgDOTACreateTeamResponse_Result.NameEmpty;
    }
    if (name.length > 20) {
        return CMsgDOTACreateTeamResponse_Result.NameTooLong;
    }
    if (!ctx.services.teams.nameAvailable(name)) {
        return CMsgDOTACreateTeamResponse_Result.NameTaken;
    }
    if (!hasText(tag)) {
        return CMsgDOTACreateTeamResponse_Result.TagEmpty;
    }
    if (tag.length > 20) {
        return CMsgDOTACreateTeamResponse_Result.TagTooLong;
    }
    if (hasLowercaseOrDigit(tag)) {
        return CMsgDOTACreateTeamResponse_Result.TagBadCharacters;
    }
    if (!ctx.services.teams.tagAvailable(tag)) {
        return CMsgDOTACreateTeamResponse_Result.TagTaken;
    }
    if ((request.logo ?? 0n) === 0n || (request.baseLogo ?? 0n) === 0n || (request.bannerLogo ?? 0n) === 0n) {
        return CMsgDOTACreateTeamResponse_Result.LogoUploadFailed;
    }
    return CMsgDOTACreateTeamResponse_Result.Success;
}

function toTeamUpsert(
    teamId: number,
    request: CMsgDOTACreateTeam | CMsgDOTAEditTeamDetails,
    existing: DotaTeam | null = null
): DotaTeamUpsert {
    const existingName = existing === null ? "" : existing.name;
    const existingTag = existing === null ? "" : existing.tag;
    const existingLogo = existing === null ? 0n : existing.logo;
    const existingBaseLogo = existing === null ? 0n : existing.baseLogo;
    const existingBannerLogo = existing === null ? 0n : existing.bannerLogo;
    const existingCountry = existing === null ? "" : existing.countryCode;
    const existingUrl = existing === null ? "" : existing.url;
    const existingAbbrev = existing === null ? "" : existing.abbreviation;

    let pickupTeam = false;
    if ("pickupTeam" in request) {
        const createRequest = request as CMsgDOTACreateTeam;
        pickupTeam = createRequest.pickupTeam === undefined ? false : createRequest.pickupTeam;
    }

    return {
        teamId,
        name: request.name === undefined ? existingName : request.name,
        tag: request.tag === undefined ? existingTag : request.tag,
        logo: request.logo === undefined ? existingLogo : request.logo,
        baseLogo: request.baseLogo === undefined ? existingBaseLogo : request.baseLogo,
        bannerLogo: request.bannerLogo === undefined ? existingBannerLogo : request.bannerLogo,
        sponsorLogo: request.sponsorLogo === undefined ? 0n : request.sponsorLogo,
        countryCode: request.countryCode === undefined ? existingCountry : request.countryCode,
        url: request.url === undefined ? existingUrl : request.url,
        pickupTeam,
        abbreviation: request.abbreviation === undefined ? existingAbbrev : request.abbreviation
    };
}

function isMember(team: any, accountId: number): boolean {
    if (team === null || team === undefined) {
        return false;
    }
    return findMember(team, accountId) !== null;
}

function isAdmin(team: any, accountId: number): boolean {
    if (team === null || team === undefined) {
        return false;
    }
    const member = findMember(team, accountId);
    if (member === null) {
        return false;
    }
    return member.role === TEAM_ROLE_ADMIN;
}

function findMember(team: any, accountId: number): any {
    const members = teamMembers(team);
    for (let i = 0; i < members.length; i++) {
        if (members[i].accountId === accountId) {
            return members[i];
        }
    }
    return null;
}

function teamMembers(team: any): any {
    if (team === null || team === undefined) {
        return [];
    }
    return Array.isArray(team.members) ? team.members : [];
}

function pendingInviteFor(accountId: number): PendingTeamInvite | null {
    for (let i = 0; i < pendingInvites.length; i++) {
        if (pendingInvites[i].targetAccountId === accountId) {
            return pendingInvites[i];
        }
    }
    return null;
}

function takePendingInvite(accountId: number): PendingTeamInvite | null {
    for (let i = 0; i < pendingInvites.length; i++) {
        if (pendingInvites[i].targetAccountId === accountId) {
            const invite = pendingInvites[i];
            pendingInvites.splice(i, 1);
            return invite;
        }
    }
    return null;
}

function steamIdFromAccountId(accountId: number): bigint {
    // TypeSharp has no >>> (ShiftRightUnsigned); account IDs are non-negative.
    return 76561197960265728n + BigInt(accountId);
}

function hasText(value: string | undefined): boolean {
    const textValue: string = value === undefined ? "" : value;
    return textValue.trim().length > 0;
}

function hasLowercaseOrDigit(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) {
            return true;
        }
    }
    return false;
}

function queueToSteam<TMessage>(
    ctx: RawMessageContext,
    steamId: bigint,
    messageType: number,
    proto: { name: string },
    message: TMessage
): boolean {
    if (steamId === ctx.steamId) {
        ctx.send(messageType, proto, message);
        return true;
    }

    return ctx.services.lobby.queueMessage(steamId, messageType, ctx.encode(proto, message), true);
}
