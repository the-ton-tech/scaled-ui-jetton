import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { JettonMinter } from "../wrappers/JettonMinter";
import { compile } from "@ton/blueprint";
import '@ton/test-utils';
import { Cell, toNano } from "@ton/core";
import { Errors } from "../wrappers/JettonConstants";

describe('Scaled UI', () => {
    let code: Cell;
    let walletCode: Cell;

    beforeAll(async () => {
        code = await compile('JettonMinter');
        walletCode = await compile('JettonWallet');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    wallet_code: walletCode,
                    jetton_content: Cell.EMPTY,
                },
                code,
            )
        );

        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('1'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            deploy: true,
        });
    });

    it('should be compliant with the standard', async () => {
        const newNumerator = 3n;
        const newDenominator = 2n;
        const setScaledUiDataResult = await jettonMinter.sendSetScaledUiData(deployer.getSender(), newNumerator, newDenominator, 'test');

        expect(setScaledUiDataResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        const parsed = JettonMinter.parseDisplayMultiplierChanged(setScaledUiDataResult.externals[0].body.beginParse());
        expect(parsed.numerator).toBe(newNumerator);
        expect(parsed.denominator).toBe(newDenominator);
        expect(parsed.comment).toBe('test');

        const displayMultiplier = await jettonMinter.getDisplayMultiplier();
        expect(displayMultiplier.numerator).toBe(newNumerator);
        expect(displayMultiplier.denominator).toBe(newDenominator);
    });

    it('should not be able to set scaled ui data with zero multiplier', async () => {
        const setScaledUiDataResult1 = await jettonMinter.sendSetScaledUiData(deployer.getSender(), 0n, 1n, 'test');

        expect(setScaledUiDataResult1.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.zero_multiplier,
        });

        const setScaledUiDataResult2 = await jettonMinter.sendSetScaledUiData(deployer.getSender(), 1n, 0n, 'test');

        expect(setScaledUiDataResult2.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.zero_multiplier,
        });
    });

    it('should not be able to schedule scaled ui change with zero multiplier', async () => {
        const scheduleScaledUiChangeResult1 = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), {
            scheduled_after: 1,
            numerator: 0n,
            denominator: 1n,
            comment: 'test',
        });

        expect(scheduleScaledUiChangeResult1.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.zero_multiplier,
        });

        const scheduleScaledUiChangeResult2 = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), {
            scheduled_after: 1,
            numerator: 1n,
            denominator: 0n,
            comment: 'test',
        });
        
        expect(scheduleScaledUiChangeResult2.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.zero_multiplier,
        });
    });

    it('should be able to schedule scaled ui change', async () => {
        const now = Math.floor(Date.now() / 1000);

        blockchain.now = now;

        const scheduleScaledUiChangeResult = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), {
            scheduled_after: now + 1,
            numerator: 1n,
            denominator: 2n,
            comment: 'test',
        });
        
        expect(scheduleScaledUiChangeResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        let displayMultiplier = await jettonMinter.getDisplayMultiplier();
        expect(displayMultiplier.numerator).toBe(1n);
        expect(displayMultiplier.denominator).toBe(1n);

        let scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(now + 1);
        expect(scheduledChange.numerator).toBe(1n);
        expect(scheduledChange.denominator).toBe(2n);
        expect(scheduledChange.comment).toBe('test');

        const enacter = await blockchain.treasury('enacter');
        let enactScheduledScaledUiChangeResult = await jettonMinter.sendEnactScheduledScaledUiChange(enacter.getSender());

        expect(enactScheduledScaledUiChangeResult.transactions).toHaveTransaction({
            from: enacter.address,
            on: jettonMinter.address,
            success: false,
        });

        blockchain.now = now + 1;
        enactScheduledScaledUiChangeResult = await jettonMinter.sendEnactScheduledScaledUiChange(enacter.getSender());

        expect(enactScheduledScaledUiChangeResult.transactions).toHaveTransaction({
            from: enacter.address,
            on: jettonMinter.address,
            success: true,
        });

        const parsed = JettonMinter.parseDisplayMultiplierChanged(enactScheduledScaledUiChangeResult.externals[0].body.beginParse());
        expect(parsed.numerator).toBe(1n);
        expect(parsed.denominator).toBe(2n);
        expect(parsed.comment).toBe('test');

        displayMultiplier = await jettonMinter.getDisplayMultiplier();
        expect(displayMultiplier.numerator).toBe(1n);
        expect(displayMultiplier.denominator).toBe(2n);

        scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(null);
        expect(scheduledChange.numerator).toBe(null);
        expect(scheduledChange.denominator).toBe(null);
        expect(scheduledChange.comment).toBe(null);
    });

    it('should not be able to do admin actions by non-admin', async () => {
        const nonAdmin = await blockchain.treasury('non-admin');
        const setScaledUiDataResult = await jettonMinter.sendSetScaledUiData(nonAdmin.getSender(), 1n, 2n, 'test');

        expect(setScaledUiDataResult.transactions).toHaveTransaction({
            from: nonAdmin.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.not_owner,
        });

        const scheduleScaledUiChangeResult = await jettonMinter.sendScheduleScaledUiChange(nonAdmin.getSender(), {
            scheduled_after: 1,
            numerator: 1n,
            denominator: 2n,
            comment: 'test',
        });
        
        expect(scheduleScaledUiChangeResult.transactions).toHaveTransaction({
            from: nonAdmin.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.not_owner,
        });

        const enactScheduledScaledUiChangeResult = await jettonMinter.sendEnactScheduledScaledUiChange(nonAdmin.getSender());
        expect(enactScheduledScaledUiChangeResult.transactions).toHaveTransaction({
            from: nonAdmin.address,
            on: jettonMinter.address,
            success: false,
            exitCode: Errors.no_scheduled_change,
        });
    });

    it('should be able to preserve scheduled change', async () => {
        const scheduleScaledUiChangeResult = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), {
            scheduled_after: 1,
            numerator: 1n,
            denominator: 2n,
            comment: 'test',
        });

        expect(scheduleScaledUiChangeResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        let scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(1);
        expect(scheduledChange.numerator).toBe(1n);
        expect(scheduledChange.denominator).toBe(2n);
        expect(scheduledChange.comment).toBe('test');

        const setScaledUiDataResult = await jettonMinter.sendSetScaledUiData(deployer.getSender(), 1n, 2n, 'test', true);
        expect(setScaledUiDataResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        let displayMultiplier = await jettonMinter.getDisplayMultiplier();
        expect(displayMultiplier.numerator).toBe(1n);
        expect(displayMultiplier.denominator).toBe(2n);

        scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(1);
        expect(scheduledChange.numerator).toBe(1n);
        expect(scheduledChange.denominator).toBe(2n);
        expect(scheduledChange.comment).toBe('test');

        const setScaledUiDataResult2 = await jettonMinter.sendSetScaledUiData(deployer.getSender(), 1n, 3n, 'test', false);
        expect(setScaledUiDataResult2.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(null);
        expect(scheduledChange.numerator).toBe(null);
        expect(scheduledChange.denominator).toBe(null);
        expect(scheduledChange.comment).toBe(null);

        displayMultiplier = await jettonMinter.getDisplayMultiplier();
        expect(displayMultiplier.numerator).toBe(1n);
        expect(displayMultiplier.denominator).toBe(3n);
    });

    it('should be able to deschedule scheduled change', async () => {
        const scheduleScaledUiChangeResult = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), {
            scheduled_after: 1,
            numerator: 1n,
            denominator: 2n,
            comment: 'test',
        });
        
        expect(scheduleScaledUiChangeResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        let scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(1);
        expect(scheduledChange.numerator).toBe(1n);
        expect(scheduledChange.denominator).toBe(2n);
        expect(scheduledChange.comment).toBe('test');

        const descheduleScheduledScaledUiChangeResult = await jettonMinter.sendScheduleScaledUiChange(deployer.getSender(), undefined);
        expect(descheduleScheduledScaledUiChangeResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true,
        });

        scheduledChange = await jettonMinter.getScheduledChange();
        expect(scheduledChange.scheduledAfter).toBe(null);
        expect(scheduledChange.numerator).toBe(null);
        expect(scheduledChange.denominator).toBe(null);
        expect(scheduledChange.comment).toBe(null);
    });
});
