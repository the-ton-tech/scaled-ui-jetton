import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode, Slice,
    toNano
} from '@ton/core';
import {JettonWallet} from './JettonWallet';
import {Op} from './JettonConstants';

type ScheduledChange = {
    scheduled_after: number,
    new_numerator: bigint,
    new_denominator: bigint,
    comment: Cell | null,
}

type ScaledUiData = {
    numerator: bigint,
    denominator: bigint,
    scheduled_change: ScheduledChange | null,
}

export type JettonMinterContent = {
    uri: string
};
export type JettonMinterConfig = {
    admin: Address,
    wallet_code: Cell,
    jetton_content: Cell | JettonMinterContent
};
export type JettonMinterConfigFull = {
    supply: bigint,
    admin: Address,
    //Makes no sense to update transfer admin. ...Or is it?
    transfer_admin: Address | null,
    wallet_code: Cell,
    jetton_content: Cell | JettonMinterContent,
    scaled_ui_data: ScaledUiData,
}

export type LockType = 'unlock' | 'out' | 'in' | 'full';

export const LOCK_TYPES = ['unlock', 'out', 'in', 'full'];

export const lockTypeToInt = (lockType: LockType): number => {
    switch (lockType) {
        case 'unlock':
            return 0;
        case 'out':
            return 1;
        case 'in':
            return 2;
        case 'full':
            return 3;
        default:
            throw new Error("Invalid argument!");
    }
}

export const intToLockType = (lockType: number): LockType => {
    switch (lockType) {
        case 0:
            return 'unlock';
        case 1:
            return 'out';
        case 2:
            return 'in';
        case 3:
            return 'full';
        default:
            throw new Error("Invalid argument!");
    }
}

export function endParse(slice: Slice) {
    if (slice.remainingBits > 0 || slice.remainingRefs > 0) {
        throw new Error('remaining bits in data');
    }
}

function packScaledUiData(data: ScaledUiData): Cell {
    return beginCell()
        .storeVarUint(data.numerator, 5)
        .storeVarUint(data.denominator, 5)
        .storeMaybeRef(data.scheduled_change === null ? null : beginCell()
            .storeUint(data.scheduled_change.scheduled_after, 64)
            .storeVarUint(data.scheduled_change.new_numerator, 5)
            .storeVarUint(data.scheduled_change.new_denominator, 5)
            .storeMaybeRef(data.scheduled_change.comment)
            .endCell())
        .endCell();
}

function unpackScaledUiData(data: Cell): ScaledUiData {
    const sc = data.beginParse();
    const scheduledChange = sc.loadMaybeRef();
    return {
        numerator: sc.loadVarUintBig(5),
        denominator: sc.loadVarUintBig(5),
        scheduled_change: scheduledChange === null ? null : {
            scheduled_after: sc.loadUint(64),
            new_numerator: sc.loadVarUintBig(5),
            new_denominator: sc.loadVarUintBig(5),
            comment: sc.loadMaybeRef()
        }
    }
}

export function jettonMinterConfigCellToConfig(config: Cell): JettonMinterConfigFull {
    const sc = config.beginParse()
    const parsed: JettonMinterConfigFull = {
        supply: sc.loadCoins(),
        admin: sc.loadAddress(),
        transfer_admin: sc.loadMaybeAddress(),
        wallet_code: sc.loadRef(),
        jetton_content: sc.loadRef(),
        scaled_ui_data: unpackScaledUiData(sc.loadRef())
    };
    endParse(sc);
    return parsed;
}

export function parseJettonMinterData(data: Cell): JettonMinterConfigFull {
    return jettonMinterConfigCellToConfig(data);
}

export function jettonMinterConfigFullToCell(config: JettonMinterConfigFull): Cell {
    const content = config.jetton_content instanceof Cell ? config.jetton_content : jettonContentToCell(config.jetton_content);
    return beginCell()
        .storeCoins(config.supply)
        .storeAddress(config.admin)
        .storeAddress(config.transfer_admin)
        .storeRef(config.wallet_code)
        .storeRef(content)
        .storeRef(packScaledUiData(config.scaled_ui_data))
        .storeUint(0, 64)
        .endCell()
}

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    const content = config.jetton_content instanceof Cell ? config.jetton_content : jettonContentToCell(config.jetton_content);
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeAddress(null) // Transfer admin address
        .storeRef(config.wallet_code)
        .storeRef(content)
        .storeRef(packScaledUiData({ numerator: 1000000000n, denominator: 1000000000n, scheduled_change: null }))
        .storeUint(0, 64)
        .endCell();
}

export function jettonContentToCell(content: JettonMinterContent) {
    return beginCell()
        .storeStringRefTail(content.uri) //Snake logic under the hood
        .endCell();
}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
    }

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = {code, data};
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Op.top_up, 32).storeUint(0, 64).endCell(),
        });
    }

    static mintMessage(to: Address, jetton_amount: bigint, from?: Address | null, response?: Address | null, customPayload?: Cell | null, forward_ton_amount: bigint = 0n, total_ton_amount: bigint = 0n) {
        const mintMsg = beginCell().storeUint(Op.internal_transfer, 32)
            .storeUint(0, 64)
            .storeCoins(jetton_amount)
            .storeAddress(from)
            .storeAddress(response)
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(customPayload)
            .endCell();
        return beginCell().storeUint(Op.mint, 32).storeUint(0, 64) // op, queryId
            .storeAddress(to)
            .storeCoins(total_ton_amount)
            .storeRef(mintMsg)
            .endCell();
    }

    static parseMintInternalMessage(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.internal_transfer) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const fromAddress = slice.loadAddress();
        const responseAddress = slice.loadAddress();
        const forwardTonAmount = slice.loadCoins();
        const customPayload = slice.loadMaybeRef();
        endParse(slice);
        return {
            queryId,
            jettonAmount,
            fromAddress,
            responseAddress,
            forwardTonAmount,
            customPayload
        }
    }

    static parseMintMessage(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.mint) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const toAddress = slice.loadAddress();
        const tonAmount = slice.loadCoins();
        const mintMsg = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            toAddress,
            tonAmount,
            internalMessage: this.parseMintInternalMessage(mintMsg.beginParse())
        }
    }

    async sendMint(provider: ContractProvider,
                   via: Sender,
                   to: Address,
                   jetton_amount: bigint,
                   from?: Address | null,
                   response_addr?: Address | null,
                   customPayload?: Cell | null,
                   forward_ton_amount: bigint = toNano('0.05'), total_ton_amount: bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.mintMessage(to, jetton_amount, from, response_addr, customPayload, forward_ton_amount, total_ton_amount),
            value: total_ton_amount,
        });
    }

    /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
    */
    static discoveryMessage(owner: Address, include_address: boolean) {
        return beginCell().storeUint(Op.provide_wallet_address, 32).storeUint(0, 64) // op, queryId
            .storeAddress(owner).storeBit(include_address)
            .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean, value: bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.discoveryMessage(owner, include_address),
            value: value,
        });
    }

    static topUpMessage() {
        return beginCell().storeUint(Op.top_up, 32).storeUint(0, 64) // op, queryId
            .endCell();
    }

    static parseTopUp(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.top_up) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        endParse(slice);
        return {
            queryId,
        }
    }

    async sendTopUp(provider: ContractProvider, via: Sender, value: bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.topUpMessage(),
            value: value,
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(Op.change_admin, 32).storeUint(0, 64) // op, queryId
            .storeAddress(newOwner)
            .endCell();
    }

    static parseChangeAdmin(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.change_admin) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newAdminAddress = slice.loadAddress();
        endParse(slice);
        return {
            queryId,
            newAdminAddress
        }
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeAdminMessage(newOwner),
            value: toNano("0.1"),
        });
    }

    static claimAdminMessage(query_id: bigint = 0n) {
        return beginCell().storeUint(Op.claim_admin, 32).storeUint(query_id, 64).endCell();
    }

    static parseClaimAdmin(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.claim_admin) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        endParse(slice);
        return {
            queryId
        }
    }

    async sendClaimAdmin(provider: ContractProvider, via: Sender, query_id: bigint = 0n) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.claimAdminMessage(query_id),
            value: toNano('0.1')
        })
    }

    static changeContentMessage(content: Cell | JettonMinterContent) {
        const contentString = content instanceof Cell ? content.beginParse().loadStringTail() : content.uri;
        return beginCell().storeUint(Op.change_metadata_url, 32).storeUint(0, 64) // op, queryId
            .storeStringTail(contentString)
            .endCell();
    }

    static parseChangeContent(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.change_metadata_url) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newMetadataUrl = slice.loadStringTail();
        endParse(slice);
        return {
            queryId,
            newMetadataUrl
        }
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell | JettonMinterContent) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeContentMessage(content),
            value: toNano("0.1"),
        });
    }

    static lockWalletMessage(lock_address: Address, lock: number, amount: bigint, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(lock_address)
            .storeCoins(amount)
            .storeRef(beginCell().storeUint(Op.set_status, 32).storeUint(query_id, 64).storeUint(lock, 4).endCell())
            .endCell();
    }

    static parseSetStatus(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.set_status) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newStatus = slice.loadUint(4);
        endParse(slice);
        return {
            queryId,
            newStatus
        }
    }

    static parseCallTo(slice: Slice, refPrser: (slice: Slice) => any) {
        const op = slice.loadUint(32);
        if (op !== Op.call_to) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const toAddress = slice.loadAddress();
        const tonAmount = slice.loadCoins();
        const ref = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            toAddress,
            tonAmount,
            action: refPrser(ref.beginParse())
        }
    }

    async sendLockWallet(provider: ContractProvider, via: Sender, lock_address: Address, lock: LockType, amount: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        const lockCmd: number = lockTypeToInt(lock);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.lockWalletMessage(lock_address, lockCmd, amount, query_id),
            value: amount + toNano('0.1')
        });
    }

    static forceTransferMessage(transfer_amount: bigint,
                                to: Address,
                                from: Address,
                                custom_payload: Cell | null,
                                forward_amount: bigint = 0n,
                                forward_payload: Cell | null,
                                value: bigint = toNano('0.1'),
                                query_id: bigint = 0n) {

        const transferMessage = JettonWallet.transferMessage(transfer_amount,
            to,
            to,
            custom_payload,
            forward_amount,
            forward_payload);
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(from)
            .storeCoins(value)
            .storeRef(transferMessage)
            .endCell();
    }

    static parseTransfer(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.transfer) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const toAddress = slice.loadAddress();
        const responseAddress = slice.loadAddress();
        const customPayload = slice.loadMaybeRef();
        const forwardTonAmount = slice.loadCoins();
        const inRef = slice.loadBit();
        const forwardPayload = inRef ? slice.loadRef().beginParse() : slice;
        return {
            queryId,
            jettonAmount,
            toAddress,
            responseAddress,
            customPayload,
            forwardTonAmount,
            forwardPayload
        }
    }

    async sendForceTransfer(provider: ContractProvider,
                            via: Sender,
                            transfer_amount: bigint,
                            to: Address,
                            from: Address,
                            custom_payload: Cell | null,
                            forward_amount: bigint = 0n,
                            forward_payload: Cell | null,
                            value: bigint = toNano('0.1'),
                            query_id: bigint = 0n) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.forceTransferMessage(transfer_amount,
                to, from,
                custom_payload,
                forward_amount,
                forward_payload,
                value, query_id),
            value: value + toNano('0.1')
        });
    }

    static forceBurnMessage(burn_amount: bigint,
                            to: Address,
                            response: Address | null,
                            value: bigint = toNano('0.1'),
                            query_id: bigint | number = 0) {

        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(to)
            .storeCoins(value)
            .storeRef(JettonWallet.burnMessage(burn_amount, response, null))
            .endCell()
    }

    static parseBurn(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.burn) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const responseAddress = slice.loadAddress();
        const customPayload = slice.loadMaybeRef();
        endParse(slice);
        return {
            queryId,
            jettonAmount,
            responseAddress,
            customPayload,
        }
    }
    async sendForceBurn(provider: ContractProvider,
                        via: Sender,
                        burn_amount: bigint,
                        address: Address,
                        response: Address | null,
                        value: bigint = toNano('0.1'),
                        query_id: bigint | number = 0) {

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.forceBurnMessage(burn_amount, address, response, value, query_id),
            value: value + toNano('0.1')
        });
    }

    static upgradeMessage(new_code: Cell, new_data: Cell, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.upgrade, 32).storeUint(query_id, 64)
            .storeRef(new_data)
            .storeRef(new_code)
            .endCell();
    }

    static parseUpgrade(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.upgrade) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newData = slice.loadRef();
        const newCode = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            newData,
            newCode
        }
    }

    async sendUpgrade(provider: ContractProvider, via: Sender, new_code: Cell, new_data: Cell, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.upgradeMessage(new_code, new_data, query_id),
            value
        });
    }

    static setScaledUiDataMessage(numerator: bigint, denominator: bigint, comment?: string, preserve_scheduled_change: boolean = false, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.set_scaled_ui_data, 32).storeUint(query_id, 64)
            .storeVarUint(numerator, 5)
            .storeVarUint(denominator, 5)
            .storeMaybeRef(comment === undefined ? null : beginCell().storeStringTail(comment).endCell())
            .storeBit(preserve_scheduled_change)
            .endCell();
    }

    static parseSetScaledUiData(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.set_scaled_ui_data) throw new Error('Invalid op');
        const queryId = slice.loadUintBig(64);
        const numerator = slice.loadVarIntBig(5);
        const denominator = slice.loadVarIntBig(5);
        const preserveScheduledChange = slice.loadBit();
        const hasComment = slice.loadBit();
        const comment = hasComment ? slice.loadStringTail() : undefined;
        endParse(slice);
        return {
            queryId,
            numerator,
            denominator,
            comment,
            preserveScheduledChange
        }
    }

    async sendSetScaledUiData(provider: ContractProvider, via: Sender, numerator: bigint, denominator: bigint, comment?: string, preserve_scheduled_change: boolean = false, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.setScaledUiDataMessage(numerator, denominator, comment, preserve_scheduled_change, query_id),
            value: value,
        });
    }

    static scheduleScaledUiChangeMessage(data: {
        scheduled_after: number,
        numerator: bigint,
        denominator: bigint,
        comment?: string,
    } | undefined, query_id: bigint | number = 0) {
        if (data === undefined) {
            return beginCell().storeUint(Op.schedule_scaled_ui_change, 32).storeUint(query_id, 64).storeBit(false).endCell();
        }
        return beginCell().storeUint(Op.schedule_scaled_ui_change, 32).storeUint(query_id, 64).storeBit(true)
            .storeUint(data.scheduled_after, 64)
            .storeVarUint(data.numerator, 5)
            .storeVarUint(data.denominator, 5)
            .storeMaybeRef(data.comment === undefined ? null : beginCell().storeStringTail(data.comment).endCell())
            .endCell();
    }

    static parseScheduleScaledUiChange(slice: Slice): { queryId: bigint, data: { scheduledAfter: number, numerator: bigint, denominator: bigint, comment?: string } | undefined } {
        const op = slice.loadUint(32);
        if (op !== Op.schedule_scaled_ui_change) throw new Error('Invalid op');
        const queryId = slice.loadUintBig(64);
        const hasData = slice.loadBit();
        if (!hasData) {
            endParse(slice);
            return {
                queryId,
                data: undefined
            }
        }
        const scheduledAfter = slice.loadUint(64);
        const numerator = slice.loadVarIntBig(5);
        const denominator = slice.loadVarIntBig(5);
        const hasComment = slice.loadBit();
        const comment = hasComment ? slice.loadStringTail() : undefined;
        endParse(slice);
        return {
            queryId,
            data: {
                scheduledAfter,
                numerator,
                denominator,
                comment
            }
        }
    }

    async sendScheduleScaledUiChange(provider: ContractProvider, via: Sender, data: {
        scheduled_after: number,
        numerator: bigint,
        denominator: bigint,
        comment?: string,
    } | undefined, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.scheduleScaledUiChangeMessage(data, query_id),
            value: value,
        });
    }

    static enactScheduledScaledUiChangeMessage(query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.enact_scheduled_scaled_ui_change, 32).storeUint(query_id, 64).endCell();
    }

    static parseEnactScheduledScaledUiChange(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.enact_scheduled_scaled_ui_change) throw new Error('Invalid op');
        const queryId = slice.loadUintBig(64);
        endParse(slice);
        return { queryId };
    }

    async sendEnactScheduledScaledUiChange(provider: ContractProvider, via: Sender, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.enactScheduledScaledUiChangeMessage(query_id),
            value: value,
        });
    }

    static parseDisplayMultiplierChanged(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.display_multiplier_changed) throw new Error('Invalid op');
        const numerator = slice.loadVarUintBig(5);
        const denominator = slice.loadVarUintBig(5);
        const hasComment = slice.loadBit();
        const comment = hasComment ? slice.loadStringTail() : undefined;
        endParse(slice);
        return {
            numerator,
            denominator,
            comment
        }
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{
            type: 'slice',
            cell: beginCell().storeAddress(owner).endCell()
        }])
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode,
        };
    }

    async getTotalSupply(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.totalSupply;
    }

    async getAdminAddress(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.adminAddress;
    }

    async getContent(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.content;
    }

    async getNextAdminAddress(provider: ContractProvider) {
        const res = await provider.get('get_next_admin_address', []);
        return res.stack.readAddressOpt();
    }

    async getDisplayMultiplier(provider: ContractProvider) {
        const res = await provider.get('get_display_multiplier', []);
        return {
            numerator: res.stack.readBigNumber(),
            denominator: res.stack.readBigNumber(),
        }
    }

    async getScheduledChange(provider: ContractProvider) {
        const res = await provider.get('get_scheduled_change', []);
        return {
            scheduledAfter: res.stack.readNumberOpt(),
            numerator: res.stack.readBigNumberOpt(),
            denominator: res.stack.readBigNumberOpt(),
            comment: res.stack.readStringOpt(),
        }
    }
}
