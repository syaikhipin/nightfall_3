/* eslint-disable no-await-in-loop */

import chai from 'chai';
import chaiHttp from 'chai-http';
import chaiAsPromised from 'chai-as-promised';
import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import Nf3 from '../../../cli/lib/nf3.mjs';
import { emptyL2, expectTransaction, Web3Client } from '../../utils.mjs';
import { getERCInfo } from '../../../cli/lib/tokens.mjs';

// so we can use require with mjs file
const { expect } = chai;
chai.use(chaiHttp);
chai.use(chaiAsPromised);
const environment = config.ENVIRONMENTS[process.env.ENVIRONMENT] || config.ENVIRONMENTS.localhost;

const {
  fee,
  transferValue,
  tokenConfigs: { tokenTypeERC721, tokenType, tokenId },
  mnemonics,
  signingKeys,
} = config.TEST_OPTIONS;

const nf3Users = [new Nf3(signingKeys.user1, environment), new Nf3(signingKeys.user2, environment)];
const nf3Proposer1 = new Nf3(signingKeys.proposer1, environment);

const web3Client = new Web3Client();

let erc721Address;
// why do we need an ERC20 token in an ERC721 test, you ask?
// let me tell you I also don't know, but I guess we just want to fill some blocks?
let erc20Address;
let stateAddress;
const eventLogs = [];
let availableTokenIds;
let rollbackCount = 0;

/*
  This function tries to zero the number of unprocessed transactions in the optimist node
  that nf3 is connected to. We call it extensively on the tests, as we want to query stuff from the
  L2 layer, which is dependent on a block being made. We also need 0 unprocessed transactions by the end
  of the tests, otherwise the optimist will become out of sync with the L2 block count on-chain.
*/

describe('ERC721 tests', () => {
  before(async () => {
    await nf3Proposer1.init(mnemonics.proposer);
    await nf3Proposer1.registerProposer('http://optimist', await nf3Proposer1.getMinimumStake());

    // Proposer listening for incoming events
    const newGasBlockEmitter = await nf3Proposer1.startProposer();
    newGasBlockEmitter.on('rollback', () => {
      rollbackCount += 1;
      logger.debug(
        `Proposer received a signalRollback complete, Now no. of rollbacks are ${rollbackCount}`,
      );
    });

    await nf3Users[0].init(mnemonics.user1);
    await nf3Users[1].init(mnemonics.user2);
    erc20Address = await nf3Users[0].getContractAddress('ERC20Mock');
    erc721Address = await nf3Users[0].getContractAddress('ERC721Mock');

    stateAddress = await nf3Users[0].stateContractAddress;
    web3Client.subscribeTo('logs', eventLogs, { address: stateAddress });

    availableTokenIds = (
      await getERCInfo(erc721Address, nf3Users[0].ethereumAddress, web3Client.getWeb3(), {
        details: true,
      })
    ).details.map(t => t.tokenId);

    await nf3Users[0].deposit(erc20Address, tokenType, transferValue, tokenId, 0);

    await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });
  });

  describe('Deposit', () => {
    it('should deposit some ERC721 crypto into a ZKP commitment', async function () {
      const tokenToDeposit = availableTokenIds.shift();

      const myPublicKey = nf3Users[0].zkpKeys.compressedZkpPublicKey;
      const balanceBefore = (await nf3Users[0].getLayer2Balances())[erc721Address]?.length || 0;
      const unspentCommitmentsBefore = await nf3Users[0].getLayer2Commitments(
        [erc721Address],
        true,
      );
      let nUnspentCommitmentsBefore = 0;
      if (myPublicKey in unspentCommitmentsBefore && unspentCommitmentsBefore[myPublicKey]) {
        nUnspentCommitmentsBefore = unspentCommitmentsBefore[myPublicKey][erc721Address].length;
      }

      // We create enough transactions to fill blocks full of deposits.
      const res = await nf3Users[0].deposit(erc721Address, tokenTypeERC721, 0, tokenToDeposit, fee);
      expectTransaction(res);

      await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

      const balanceAfter = (await nf3Users[0].getLayer2Balances())[erc721Address]?.length || 0;
      const unspentCommitmentsAfter = await nf3Users[0].getLayer2Commitments([erc721Address], true);
      let nUnspentCommitmentsAfter = 0;
      if (myPublicKey in unspentCommitmentsAfter && unspentCommitmentsAfter[myPublicKey]) {
        nUnspentCommitmentsAfter = unspentCommitmentsAfter[myPublicKey][erc721Address].length;
      }

      expect(balanceAfter - balanceBefore).to.be.equal(1);
      expect(nUnspentCommitmentsAfter - nUnspentCommitmentsBefore).to.be.equal(1);
    });
  });

  describe('Transfer', () => {
    it('should decrement the balance after transfer ERC721 to other wallet and increment the other wallet', async function () {
      const tokenToTransfer = availableTokenIds.shift();

      const deposit = await nf3Users[0].deposit(
        erc721Address,
        tokenTypeERC721,
        0,
        tokenToTransfer,
        fee,
      );
      expectTransaction(deposit);
      await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

      async function getBalances() {
        return Promise.all([
          await nf3Users[0].getLayer2Balances(),
          await nf3Users[1].getLayer2Balances(),
        ]);
      }

      const balancesBefore = await getBalances();

      const res = await nf3Users[0].transfer(
        false,
        erc721Address,
        tokenTypeERC721,
        0,
        tokenToTransfer,
        nf3Users[1].zkpKeys.compressedZkpPublicKey,
        fee,
      );
      expectTransaction(res);

      await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

      const balancesAfter = await getBalances();
      expect(
        (balancesAfter[0][erc721Address]?.length || 0) -
          (balancesBefore[0][erc721Address]?.length || 0),
      ).to.be.equal(-1);
      expect(
        (balancesAfter[1][erc721Address]?.length || 0) -
          (balancesBefore[1][erc721Address]?.length || 0),
      ).to.be.equal(1);
      console.log('Balances after', balancesAfter);
      console.log('Balances before', balancesBefore);
      expect(
        (balancesAfter[0][erc20Address]?.[0].balance || 0) -
          (balancesBefore[0][erc20Address]?.[0].balance || 0),
      ).to.be.equal(-fee);
    });
  });

  describe('Withdraw', () => {
    it('should withdraw from L2, checking for missing commitment', async function () {
      const tokenToWithdraw = availableTokenIds.shift();

      const res = await nf3Users[0].deposit(
        erc721Address,
        tokenTypeERC721,
        0,
        tokenToWithdraw,
        fee,
      );
      expectTransaction(res);
      await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

      const balancesBefore = await nf3Users[0].getLayer2Balances();

      const rec = await nf3Users[0].withdraw(
        false,
        erc721Address,
        tokenTypeERC721,
        0,
        tokenToWithdraw,
        nf3Users[0].ethereumAddress,
        fee,
      );
      expectTransaction(rec);
      logger.debug(`Gas used was ${Number(rec.gasUsed)}`);

      await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

      const balancesAfter = await nf3Users[0].getLayer2Balances();
      expect(
        (balancesAfter[erc721Address]?.length || 0) - (balancesBefore[erc721Address]?.length || 0),
      ).to.be.equal(-1);
      expect(
        (balancesAfter[erc20Address]?.[0].balance || 0) -
          (balancesBefore[erc20Address]?.[0].balance || 0),
      ).to.be.equal(-fee);
    });

    it('should withdraw from L2, checking for L1 balance (only with time-jump client)', async function () {
      const nodeInfo = await web3Client.getInfo();
      if (nodeInfo.includes('TestRPC')) {
        const tokenToWithdraw = availableTokenIds.shift();

        const deposit = await nf3Users[0].deposit(
          erc721Address,
          tokenTypeERC721,
          0,
          tokenToWithdraw,
          fee,
        );
        expectTransaction(deposit);
        await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

        const balancesBefore = await nf3Users[0].getLayer2Balances();

        const rec = await nf3Users[0].withdraw(
          false,
          erc721Address,
          tokenTypeERC721,
          0,
          tokenToWithdraw,
          nf3Users[0].ethereumAddress,
          fee,
        );
        expectTransaction(rec);
        await emptyL2({ nf3User: nf3Users[0], web3: web3Client, logs: eventLogs });

        const withdrawal = nf3Users[0].getLatestWithdrawHash();

        const balancesAfter = await nf3Users[0].getLayer2Balances();

        await web3Client.timeJump(3600 * 24 * 10); // jump in time by 10 days

        const commitments = await nf3Users[0].getPendingWithdraws();
        expect(
          commitments[nf3Users[0].zkpKeys.compressedZkpPublicKey][erc721Address].length,
        ).to.be.greaterThan(0);
        expect(
          commitments[nf3Users[0].zkpKeys.compressedZkpPublicKey][erc721Address].filter(
            c => c.valid === true,
          ).length,
        ).to.be.greaterThan(0);

        const res = await nf3Users[0].finaliseWithdrawal(withdrawal);
        expectTransaction(res);

        expect(
          (balancesAfter[erc721Address]?.length || 0) -
            (balancesBefore[erc721Address]?.length || 0),
        ).to.be.equal(-1);
        expect(
          (balancesAfter[erc20Address]?.[0].balance || 0) -
            (balancesBefore[erc20Address]?.[0].balance || 0),
        ).to.be.equal(-fee);
      } else {
        logger.info('Not using a time-jump capable test client so this test is skipped');
        this.skip();
      }
    });
  });

  describe('Rollback checks', () => {
    it('test should encounter zero rollbacks', function () {
      expect(rollbackCount).to.be.equal(0);
    });
  });

  after(async () => {
    await nf3Proposer1.deregisterProposer();
    await nf3Proposer1.close();
    await nf3Users[0].close();
    await nf3Users[1].close();
    await web3Client.closeWeb3();
  });
});
