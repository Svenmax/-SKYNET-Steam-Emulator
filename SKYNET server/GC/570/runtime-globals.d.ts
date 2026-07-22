declare global {
    type int32 = number;

    interface Clock {
        now(): number;
    }

    interface Logger {
        info(message: string): void;
    }

    function messageType(): number;
    function body(): Uint8Array;
    function now(): number;
    function steamId(): bigint;
    function accountId(): number;
    function personaName(): string;
    function decode<TMessage = any>(typeName: string, payload: Uint8Array): TMessage;
    function encode<TMessage = any>(typeName: string, value: TMessage): Uint8Array;
    function send(messageType: number, payload: Uint8Array, protobuf?: boolean): boolean;
    function reply(messageType: number, payload: Uint8Array, protobuf?: boolean): boolean;
    function log(message: string): void;
    function dotaInventory(steamId?: bigint): any;
    function dotaCatalogItem(defIndex: number): any;
    function dotaEquipItem(itemId: bigint, heroId: number, slotId: number, style: number): any;
    function dotaSetItemStyle(itemId: bigint, style: number): any;
    function dotaPublishMatchSnapshot(snapshot: any): boolean;
    function dotaListMatchSnapshots(): any;
    function dotaRemoveMatchSnapshot(lobbyId: bigint): boolean;
    function dotaStartDedicatedServer(lobbyId: bigint, map: string): any;
    function dotaReleaseDedicatedServer(lobbyId: bigint, reason: string): boolean;
    function dotaResolveGameServerConnectIp(publicIp: string, privateIp: string, fallbackIp: string): string;
    function dotaResolveGameServerConnectIps(publicIp: string, privateIp: string, fallbackIp: string): string;
    function dotaProfile(accountId: number): any;
    function dotaSaveProfileSlots(slots: any[]): boolean;
    function dotaSaveProfileUpdate(backgroundItemId: bigint, featuredHeroIds: number[]): boolean;
    function dotaProfileConductScorecard(): any;
    function dotaProfileQuestProgress(questIds: number[]): any;
    function dotaProfilePeriodicResource(accountId: number, resourceId: number): any;
    function dotaProfileHeroStickers(): any;
    function dotaProfileSetHeroSticker(heroId: number, itemId: bigint): boolean;
    function dotaProfileOverworldState(overworldId: number): any;
    function dotaProfileMonsterHunterState(): any;
    function dotaSocialEmoticonAccess(): any;
    function dotaSocialFeed(accountId: number, selfOnly: boolean): any;
    function dotaSocialFeedComments(feedEventId: bigint): any;
    function dotaSocialFeedPostComment(feedEventId: bigint, comment: string): boolean;
    function dotaSocialMatchComments(matchId: bigint): any;
    function dotaSocialMatchPostComment(matchId: bigint, comment: string): boolean;
    function dotaChatChannels(): any;
    function dotaChatJoinChannel(channelName: string, channelType: number): any;
    function dotaChatChannel(channelId: bigint): any;
    function dotaChatLeaveChannel(channelId: bigint): boolean;
    function dotaChatBroadcast(
        channelId: bigint,
        messageType: number,
        payload: Uint8Array,
        includeSelf: boolean
    ): number;
    function dotaGuildEnsureCurrent(): any;
    function dotaGuildMembership(accountId: number): any;
    function dotaGuild(guildId: number): any;
    function dotaGuildPersonaInfo(accountId: number): any;
    function dotaGuildEventData(guildId: number, eventId: number): any;
    function dotaGuildInvite(guildId: number, targetAccountId: number): number;
    function dotaGuildDeclineInvite(guildId: number): number;
    function dotaGuildCancelInvite(guildId: number, targetAccountId: number): number;
    function dotaGuildAcceptInvite(guildId: number): number;
    function dotaGuildLeave(guildId: number): number;
    function dotaReporterUpdates(): any;
    function dotaAcknowledgeReporterUpdates(matchIds: bigint[]): boolean;
    function dotaTeam(teamId: number): any;
    function dotaTeamsForAccount(accountId?: number): any;
    function dotaNextTeamId(): number;
    function dotaUpsertTeam(teamId: number, name: string, tag: string, teamJson: string): any;
    function dotaAddTeamMember(teamId: number, accountId: number, role: number): boolean;
    function dotaRemoveTeamMember(teamId: number, accountId: number): boolean;
    function dotaRemoveTeam(teamId: number): boolean;
    function dotaTeamNameAvailable(name: string, exceptTeamId: string): boolean;
    function dotaTeamTagAvailable(tag: string, exceptTeamId: string): boolean;
    function dotaTeamPlayerInfo(accountId: number): any;
    function dotaUpsertTeamPlayerInfo(
        accountId: number,
        name: string,
        countryCode: string,
        fantasyRole: number,
        teamId: number,
        sponsor: string,
        realName: string
    ): any;
    function dotaDeleteTeamPlayerInfo(accountId: number): boolean;
    function dotaLookupAccountName(accountId: number): any;
    function dotaEventPoints(accountId: number, eventId: number): any;
    function dotaHeroStandings(accountId: number): any;
    function dotaHeroGlobalData(accountId: number, heroId: number): any;
    function dotaPlayerStats(accountId: number): any;
    function dotaRank(accountId: number): any;
    function dotaTeammateStats(accountId: number): any;
    function dotaMatchHistory(
        accountId: number,
        startAtMatchId: bigint,
        requested: number,
        heroId: number,
        includePractice: boolean
    ): any;
    function dotaMatchDetails(matchId: bigint): any;
    function dotaHeroStatsHistory(accountId: number, heroId: number): any;
    function dotaMatchVotes(matchId: bigint): any;
    function dotaShowcaseStats(accountId: number): any;
    function dotaRecentAccomplishments(accountId: number): any;
    function dotaHeroRecentAccomplishments(accountId: number, heroId: number): any;
    function dotaHasMvpVote(matchId: bigint): boolean;
    function dotaVoteForMvp(matchId: bigint, votedAccountId: number): boolean;
    function dotaFinalizeMvpVote(matchId: bigint): boolean;
    function dotaSubmitLobbyMvpVote(targetAccountId: number): any;
    function dotaRecordSignOutMvpStats(matchId: bigint, players: any[]): boolean;
    function dotaRerollPlayerChallenge(): boolean;
    function dotaRecordMatchSignOutPermission(request: any): boolean;
    function dotaSetMatchHistoryAccess(allow: boolean): boolean;
    function dotaRecordServerStatus(response: number): boolean;
    function dotaRecordLeaver(event: any): boolean;
    function dotaRecordRealtimeStats(snapshot: any): boolean;
    function dotaRecordMatchStateHistory(history: any): boolean;
    function dotaRecordSpectatorCount(spectatorCount: number): boolean;
    function dotaRecordLiveScoreboard(snapshot: any): boolean;
    function dotaSavePlayerReport(report: any): boolean;
    function dotaPartyCurrent(): any;
    function dotaPartyById(partyId: bigint): any;
    function dotaPartyEnsureCurrent(ping: any): any;
    function dotaPartyAddMember(partyId: bigint, ping: any, isCoach: boolean): any;
    function dotaPartyRemoveMember(partyId: bigint, steamId: bigint): any;
    function dotaPartyDelete(partyId: bigint): boolean;
    function dotaPartySetLeader(partyId: bigint, leaderSteamId: bigint): any;
    function dotaPartySetCoach(partyId: bigint, steamId: bigint, isCoach: boolean): any;
    function dotaPartySetPing(partyId: bigint, steamId: bigint, ping: any): any;
    function dotaPartyStartReadyCheck(partyId: bigint, durationSeconds: number): any;
    function dotaPartyAcknowledgeReadyCheck(partyId: bigint, readyStatus: number): any;
    function dotaPartyCreateInvite(partyId: bigint, targetSteamId: bigint, teamId: number, asCoach: boolean): any;
    function dotaPartyTakeInvite(partyId: bigint): any;
    function dotaPartyInvitesForTarget(targetSteamId: bigint): any;
    function dotaPartyDeleteInvitesForTarget(targetSteamId: bigint): any;
    function dotaPartyDeleteInvitesForParty(partyId: bigint): any;
    function dotaPartyPruneInvitesCreatedBefore(cutoff: number): any;
    function dotaPartyUserExists(steamId: bigint): boolean;
    function dotaPartyUserOnline(steamId: bigint): boolean;
    function dotaQueueGcMessage(steamId: bigint, messageType: number, payload: Uint8Array, protobuf?: boolean): boolean;
}

export {};
