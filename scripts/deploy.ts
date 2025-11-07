import {Address, beginCell, Cell, toNano} from '@ton/core';
import {JettonMinter} from '../wrappers/JettonMinter';
import {compile, NetworkProvider} from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const jettonWalletCode = new Cell({
        exotic: true,
        bits: beginCell().storeUint(2, 8).storeBuffer(Buffer.from('j0Utek39dAZraCNlF3JZ7QVzRDW+drX9S9XYryt8PWg=', 'base64')).endCell().bits,
    });

    // const adminAddress = provider.sender().address;

    const adminAddress = Address.parse('0QDDaTsSucEWcH9kkVHCBR3PWnDhd6yetbNHIJutN5KNXltK');

    if (adminAddress === undefined) {
        throw new Error('Admin address is not set');
    }

    const minter = provider.open(JettonMinter.createFromConfig({
            admin: adminAddress,
            wallet_code: jettonWalletCode,
            jetton_content: {uri: ''}
        },
        await compile('JettonMinter')));

    await minter.sendDeploy(provider.sender(), toNano("1.5")); // send 1.5 TON
}
