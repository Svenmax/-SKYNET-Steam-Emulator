import { gc, HandlerContext, RawMessageContext } from "../framework/gc";
import {
    CMsgClientToGCCancelUnfinalizedTransactionsResponse,
    CMsgGCRequestStoreSalesData,
    CMsgGCRequestStoreSalesDataResponse,
    CMsgGCStorePurchaseCancel,
    CMsgGCStorePurchaseCancelResponse,
    CMsgGCStorePurchaseFinalize,
    CMsgGCStorePurchaseFinalizeResponse,
    CMsgGCStorePurchaseInit,
    CMsgGCStorePurchaseInitResponse,
    CMsgPurchaseHeroRandomRelic,
    CMsgPurchaseHeroRandomRelicResponse,
    CMsgPurchaseItemWithEventPoints,
    CMsgPurchaseItemWithEventPointsResponse,
    CMsgPurchaseItemWithEventPointsResponse_Result,
    CGCStorePurchaseInitLineItem,
    EPurchaseHeroRelicResult,
    Msg,
    Proto,
    Routes
} from "../generated/dota";
import {
    ECON_ITEM_TYPE_ID,
    ECON_SERVICE_ID,
    OWNER_TYPE_STEAM_ID,
    buildDotaItemInstanceId,
    buildEconItem,
    equipmentForDefIndex
} from "./InventorySos";

// The legacy client sends 8256/8257 for hero relic purchases. Current protos
// name the same payload shape as PurchaseHeroRandomRelic, so keep the protocol
// IDs and encode with the generated current descriptor.
const LEGACY_PURCHASE_HERO_RELIC_MESSAGE_ID = 8256;
const LEGACY_PURCHASE_HERO_RELIC_RESPONSE_MESSAGE_ID = 8257;

// Purchase result codes observed by the client for store init/finalize/cancel.
const STORE_RESULT_OK = 1;

// TypeSharp-friendly pending txn list (avoid complex Map narrowing).
const pendingPurchases: any = [];

export function registerEconomy(): void {
    const economy = new Economy();
    economy.register();
}

export class Economy {
    register(): void {
        gc.on(Routes.RequestStoreSalesData, (ctx) => {
            this.requestStoreSalesData(ctx);
        });
        gc.onMessage(Msg.GCStorePurchaseInit, (ctx) => this.storePurchaseInit(ctx));
        gc.onMessage(Msg.GCStorePurchaseFinalize, (ctx) => this.storePurchaseFinalize(ctx));
        gc.onMessage(Msg.GCStorePurchaseCancel, (ctx) => this.storePurchaseCancel(ctx));
        gc.onMessage(Msg.PurchaseItemWithEventPoints, (ctx) => this.purchaseItemWithEventPoints(ctx));
        gc.onMessage(LEGACY_PURCHASE_HERO_RELIC_MESSAGE_ID, (ctx) => this.purchaseHeroRelic(ctx, true));
        gc.onMessage(Msg.PurchaseHeroRandomRelic, (ctx) => this.purchaseHeroRelic(ctx, false));
        gc.onMessage(Msg.ClientToGCCancelUnfinalizedTransactions, (ctx) => this.cancelUnfinalizedTransactions(ctx));
        gc.onMessage(Msg.ClientToGCAggregateMetrics, (ctx) => this.aggregateMetrics(ctx));
    }

    private requestStoreSalesData(
        ctx: HandlerContext<CMsgGCRequestStoreSalesData, CMsgGCRequestStoreSalesDataResponse>
    ): void {
        let version: number = 0;
        if (ctx.request.version) {
            version = ctx.request.version as number;
        }

        const expiration = Math.floor(ctx.clock.now() + 86400) as number;

        ctx.reply({
            version: version,
            expirationTime: expiration
        });
    }

    private storePurchaseInit(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgGCStorePurchaseInit) as CMsgGCStorePurchaseInit;
        const lineItems = request.lineItems ?? [];
        const defIndexes = collectDefIndexes(lineItems);
        const txnId = this.createTransactionId(ctx, defIndexes.length);

        rememberPurchase(ctx.accountId, txnId, defIndexes);

        // Offline/emulator clients commonly do Init -> Cancel and never Finalize
        // (they wait for MicroTxnAuthorizationResponse which SKYNET does not
        // emit). Mirror gbe_fork: grant + SO push on Init so the backpack
        // updates even when the client aborts the txn next.
        const itemIds = grantPurchaseItems(ctx, defIndexes);

        ctx.logger.info(
            "Economy: StorePurchaseInit lineItems=" +
                defIndexes.length +
                " txnId=" +
                txnId +
                " granted=" +
                itemIds.length
        );
        ctx.reply<CMsgGCStorePurchaseInitResponse>(
            Msg.GCStorePurchaseInitResponse,
            Proto.CMsgGCStorePurchaseInitResponse,
            {
                result: STORE_RESULT_OK,
                txnId
            }
        );
        return true;
    }

    private storePurchaseFinalize(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgGCStorePurchaseFinalize) as CMsgGCStorePurchaseFinalize;
        const txnId = request.txnId ?? 0n;
        const pending = takePurchase(ctx.accountId, txnId);
        const defIndexes: any = pending === null ? [] : pending.defIndexes;
        const itemIds = grantPurchaseItems(ctx, defIndexes);

        ctx.logger.info(
            "Economy: StorePurchaseFinalize txnId=" +
                txnId +
                " defs=" +
                defIndexes.length +
                " granted=" +
                itemIds.length
        );
        ctx.reply<CMsgGCStorePurchaseFinalizeResponse>(
            Msg.GCStorePurchaseFinalizeResponse,
            Proto.CMsgGCStorePurchaseFinalizeResponse,
            {
                result: STORE_RESULT_OK,
                itemIds: itemIds
            }
        );
        return true;
    }

    private storePurchaseCancel(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgGCStorePurchaseCancel) as CMsgGCStorePurchaseCancel;
        const txnId = request.txnId ?? 0n;
        takePurchase(ctx.accountId, txnId);
        ctx.logger.info("Economy: StorePurchaseCancel txnId=" + txnId);
        ctx.reply<CMsgGCStorePurchaseCancelResponse>(
            Msg.GCStorePurchaseCancelResponse,
            Proto.CMsgGCStorePurchaseCancelResponse,
            {
                result: STORE_RESULT_OK
            }
        );
        return true;
    }

    private purchaseItemWithEventPoints(ctx: RawMessageContext): boolean {
        const request = ctx.decode(Proto.CMsgPurchaseItemWithEventPoints) as CMsgPurchaseItemWithEventPoints;
        ctx.logger.info(
            "Economy: PurchaseItemWithEventPoints itemDef=" +
                (request.itemDef ?? 0) +
                " quantity=" +
                (request.quantity ?? 0) +
                " eventId=" +
                (request.eventId ?? 0)
        );
        ctx.reply<CMsgPurchaseItemWithEventPointsResponse>(
            Msg.PurchaseItemWithEventPointsResponse,
            Proto.CMsgPurchaseItemWithEventPointsResponse,
            {
                result: CMsgPurchaseItemWithEventPointsResponse_Result.Success
            }
        );
        return true;
    }

    private purchaseHeroRelic(ctx: RawMessageContext, legacyMessageId: boolean): boolean {
        const request = ctx.decode(Proto.CMsgPurchaseHeroRandomRelic) as CMsgPurchaseHeroRandomRelic;
        ctx.logger.info(
            "Economy: PurchaseHeroRelic heroId=" +
                (request.heroId ?? 0) +
                " rarity=" +
                (request.relicRarity ?? 0) +
                " legacyId=" +
                (legacyMessageId ? "true" : "false")
        );
        ctx.reply<CMsgPurchaseHeroRandomRelicResponse>(
            legacyMessageId ? LEGACY_PURCHASE_HERO_RELIC_RESPONSE_MESSAGE_ID : Msg.PurchaseHeroRandomRelicResponse,
            Proto.CMsgPurchaseHeroRandomRelicResponse,
            {
                result: EPurchaseHeroRelicResult.PurchaseHeroRelicResultSuccess,
                killEaterType: 0
            }
        );
        return true;
    }

    private cancelUnfinalizedTransactions(ctx: RawMessageContext): boolean {
        const cleared = clearPurchasesForAccount(ctx.accountId);
        ctx.logger.info("Economy: CancelUnfinalizedTransactions cleared=" + cleared);
        ctx.reply<CMsgClientToGCCancelUnfinalizedTransactionsResponse>(
            Msg.ClientToGCCancelUnfinalizedTransactionsResponse,
            Proto.CMsgClientToGCCancelUnfinalizedTransactionsResponse,
            {
                result: STORE_RESULT_OK
            }
        );
        return true;
    }

    private aggregateMetrics(ctx: RawMessageContext): boolean {
        // Client telemetry; no response message is required.
        ctx.logger.info("Economy: AggregateMetrics ignored");
        return true;
    }

    private createTransactionId(ctx: RawMessageContext, lineItemCount: number): bigint {
        const now = BigInt(ctx.clock.now());
        const account = BigInt(ctx.accountId);
        return (now << 32n) | (account << 8n) | BigInt(lineItemCount & 0xff);
    }
}

function collectDefIndexes(lineItems: CGCStorePurchaseInitLineItem[] | undefined): any {
    const result: any = [];
    const items = lineItems ?? [];
    for (let i = 0; i < items.length; i++) {
        const line = items[i];
        const defIndex = line.itemDefId ?? 0;
        let quantity = line.quantity ?? 1;
        if (quantity < 1) {
            quantity = 1;
        }
        if (quantity > 16) {
            quantity = 16;
        }
        if (defIndex !== 0) {
            for (let q = 0; q < quantity; q++) {
                result.push(defIndex);
            }
        }
    }
    return result;
}

function rememberPurchase(accountId: number, txnId: bigint, defIndexes: any): void {
    // Replace any previous entry with the same txn id.
    takePurchase(accountId, txnId);
    pendingPurchases.push({
        accountId: accountId,
        txnId: txnId,
        defIndexes: defIndexes
    });
}

function takePurchase(accountId: number, txnId: bigint): any {
    let found: any = null;
    const kept: any = [];
    for (let i = 0; i < pendingPurchases.length; i++) {
        const entry = pendingPurchases[i];
        if (entry.accountId === accountId && entry.txnId === txnId && found === null) {
            found = entry;
        } else {
            kept.push(entry);
        }
    }
    pendingPurchases.length = 0;
    for (let i = 0; i < kept.length; i++) {
        pendingPurchases.push(kept[i]);
    }
    return found;
}

function clearPurchasesForAccount(accountId: number): number {
    let cleared = 0;
    const kept: any = [];
    for (let i = 0; i < pendingPurchases.length; i++) {
        const entry = pendingPurchases[i];
        if (entry.accountId === accountId) {
            cleared = cleared + 1;
        } else {
            kept.push(entry);
        }
    }
    pendingPurchases.length = 0;
    for (let i = 0; i < kept.length; i++) {
        pendingPurchases.push(kept[i]);
    }
    return cleared;
}

function grantPurchaseItems(ctx: RawMessageContext, defIndexes: any): any {
    const itemIds: any = [];
    if (defIndexes === null || defIndexes === undefined || defIndexes.length === 0) {
        ctx.logger.info("Economy: grant skipped empty defIndexes");
        return itemIds;
    }

    const inventory = ctx.services.items.getInventory();
    for (let i = 0; i < defIndexes.length; i++) {
        const defIndex = defIndexes[i];
        let catalogItem = ctx.services.items.getCatalogItem(defIndex);
        if (catalogItem === null) {
            // Store purchase may request a def that is not in the imported
            // catalog snapshot. Still emit a synthetic CSOEconItem so the
            // client backpack path can observe the grant (gbe does the same).
            ctx.logger.info("Economy: grant synthetic catalog defIndex=" + defIndex);
            catalogItem = {
                defIndex: defIndex,
                name: "store-grant-" + defIndex,
                qualityId: 4
            };
        }

        const itemId = buildDotaItemInstanceId(inventory.steamId, catalogItem.defIndex);
        itemIds.push(itemId);

        // Notify the client econ SO cache that this item exists/updated.
        // Msg 21 (SOSingleObject) matches the create/update path Dota expects
        // after a store purchase finalize.
        ctx.send(Msg.SOSingleObject, Proto.CMsgSOSingleObject, {
            typeId: ECON_ITEM_TYPE_ID,
            objectData: ctx.encode(
                Proto.CSOEconItem,
                buildEconItem(
                    inventory,
                    catalogItem,
                    equipmentForDefIndex(inventory, catalogItem.defIndex)
                )
            ),
            version: inventory.version,
            ownerSoid: {
                type: OWNER_TYPE_STEAM_ID,
                id: inventory.steamId
            }
        });
    }

    // Also emit a version bump style multi-object update so listeners that only
    // watch SOCacheUpdated see inventory activity after purchase.
    if (itemIds.length > 0) {
        ctx.send(Msg.SOCacheUpdated, Proto.CMsgSOMultipleObjects, {
            objectsModified: [],
            objectsAdded: [],
            version: inventory.version,
            ownerSoid: {
                type: OWNER_TYPE_STEAM_ID,
                id: inventory.steamId
            },
            serviceId: ECON_SERVICE_ID
        });
    }

    return itemIds;
}
