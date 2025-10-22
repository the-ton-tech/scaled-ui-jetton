import {beginCell, Cell, toNano} from '@ton/core';
import {JettonMinter} from '../wrappers/JettonMinter';
import {compile, NetworkProvider} from '@ton/blueprint';
import {promptUrl} from "../wrappers/ui-utils";

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const adminAddress = provider.sender().address;

    if (adminAddress === undefined) {
        throw new Error('Admin address is not set');
    }

    // USDT wallet code
    const jettonWalletCode = new Cell({
        exotic: true,
        bits: beginCell().storeUint(2, 8).storeBuffer(Buffer.from('j0Utek39dAZraCNlF3JZ7QVzRDW+drX9S9XYryt8PWg=', 'base64')).endCell().bits,
    });

    const jettonMetadataUri = await promptUrl("Enter jetton metadata uri (https://example.com/jetton.json)", ui)

    const minter = provider.open(JettonMinter.createFromConfig({
            admin: adminAddress,
            wallet_code: jettonWalletCode,
            jetton_content: {uri: jettonMetadataUri}
        },
        await compile('JettonMinter')));

    await minter.sendSetScaledUiData(provider.sender(), 1n, 1n, "initialization", false, toNano('1.5'));
}
