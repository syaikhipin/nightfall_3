import chai from 'chai';
import chaiHttp from 'chai-http';
import chaiAsPromised from 'chai-as-promised';
import { createRequire } from 'module';
import Nf3 from '../../cli/lib/nf3.mjs';
import { waitForEvent, expectTransaction, Web3Client, depositNTransactions } from '../utils.mjs';
import { getERCInfo } from '../../cli/lib/tokens.mjs';

// so we can use require with mjs file
const require = createRequire(import.meta.url);
const { expect } = chai;
chai.use(chaiHttp);
chai.use(chaiAsPromised);
const { web3WsUrl, network } = process.env;

// we need require here to import jsons
const environments = require('./environments.json');
const mnemonics = require('./mnemonics.json');
const signingKeys = require('./signingKeys.json');
const { fee, txPerBlock, transferValue } = require('./configs.json');
const { tokenTypeERC721 } = require('./tokenConfigs.json');
const { tokenType, tokenId } = require('./tokenConfigs.json');

const environment = environments[network];
const nf3Users = [
  new Nf3(web3WsUrl, signingKeys.user1, environment),
  new Nf3(web3WsUrl, signingKeys.user2, environment),
];
const nf3Proposer1 = new Nf3(web3WsUrl, signingKeys.proposer1, environment);

const web3Client = new Web3Client();

let erc721Address;
// why do we need an ERC20 token in an ERC721 test, you ask?
// let me tell you I also don't know, but I guess we just want to fill some blocks?
let erc20Address;
let stateAddress;
let eventLogs = [];
let availableTokenIds;

const evenTheBlock = async nf3Instance => {
  let count = await nf3Instance.unprocessedTransactionCount();
  while (count !== 0) {
    if (count % txPerBlock) {
      // eslint-disable-next-line no-await-in-loop
      await depositNTransactions(
        nf3Instance,
        count % txPerBlock ? count % txPerBlock : txPerBlock,
        erc20Address,
        tokenType,
        transferValue,
        tokenId,
        fee,
      );
      // eslint-disable-next-line no-await-in-loop
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
    } else {
      // eslint-disable-next-line no-await-in-loop
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
    }
    // eslint-disable-next-line no-await-in-loop
    count = await nf3Instance.unprocessedTransactionCount();
  }
};

describe('ERC721 tests', () => {
  before(async () => {
    await nf3Proposer1.init(mnemonics.proposer);
    await nf3Proposer1.registerProposer();
    await nf3Proposer1.addPeer(environment.optimistApiUrl);

    // Proposer listening for incoming events
    const newGasBlockEmitter = await nf3Proposer1.startProposer();
    newGasBlockEmitter.on('gascost', async gasUsed => {
      if (process.env.GAS_COSTS)
        console.log(
          `Block proposal gas cost was ${gasUsed}, cost per transaction was ${
            gasUsed / txPerBlock
          }`,
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

    await evenTheBlock(nf3Users[0]);
  });

  afterEach(async () => {
    await evenTheBlock(nf3Users[0]);
  });

  describe('Deposit', () => {
    it('should deposit some ERC721 crypto into a ZKP commitment', async function () {
      let balances = await nf3Users[0].getLayer2Balances();
      const balanceBefore = balances[erc721Address]?.length || 0;
      // We create enough transactions to fill blocks full of deposits.
      let res = await nf3Users[0].deposit(
        erc721Address,
        tokenTypeERC721,
        0,
        availableTokenIds.shift(),
        fee,
      );
      expectTransaction(res);
      res = await nf3Users[0].deposit(
        erc721Address,
        tokenTypeERC721,
        0,
        availableTokenIds.shift(),
        fee,
      );
      expectTransaction(res);
      // Wait until we see the right number of blocks appear
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
      await evenTheBlock(nf3Users[0]);
      balances = await nf3Users[0].getLayer2Balances();

      const balanceAfter = balances[erc721Address].length;
      expect(balanceAfter - balanceBefore).to.be.equal(2);
    });
  });

  describe('Transfer', () => {
    it('should decrement the balance after transfer ERC721 to other wallet and increment the other wallet', async function () {
      let balances;
      async function getBalances() {
        balances = [
          (await nf3Users[0].getLayer2Balances())[erc721Address],
          (await nf3Users[1].getLayer2Balances())[erc721Address],
        ];
      }

      // We create enough transactions to fill block full of deposits.
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await nf3Users[0].deposit(
          erc721Address,
          tokenTypeERC721,
          0,
          availableTokenIds.shift(),
          fee,
        );
        expectTransaction(res);
      }

      // Wait until we see the right number of blocks appear
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);

      await getBalances();
      // weird way to clone an array, but we need a deep clone as it's a multidimensional array
      const beforeBalances = JSON.parse(JSON.stringify(balances));

      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await nf3Users[0].transfer(
          false,
          erc721Address,
          tokenTypeERC721,
          0,
          balances[0].shift().tokenId,
          nf3Users[1].zkpKeys.compressedPkd,
          fee,
        );
        expectTransaction(res);
      }
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
      // await new Promise(resolve => setTimeout(resolve, 3000));

      // depositing some ERC20 transactions to fill the block
      await evenTheBlock(nf3Users[0]);

      await getBalances();

      expect((balances[0]?.length || 0) - (beforeBalances[0]?.length || 0)).to.be.equal(-2);
      expect((balances[1]?.length || 0) - (beforeBalances[1]?.length || 0)).to.be.equal(2);
    });
  });

  // TODO I believe we should also test on-chain and off-chain transfers like we do for ERC20

  describe('Withdraw', () => {
    it('should withdraw from L2, checking for missing commitment', async function () {
      const erc721balances = (await nf3Users[0].getLayer2Balances())[erc721Address];
      const beforeBalance = erc721balances.length;
      const tokenToWithdraw = erc721balances.shift().tokenId;

      const rec = await nf3Users[0].withdraw(
        false,
        erc721Address,
        tokenTypeERC721,
        0,
        tokenToWithdraw,
        nf3Users[0].ethereumAddress,
      );
      expectTransaction(rec);
      if (process.env.GAS_COSTS) console.log(`     Gas used was ${Number(rec.gasUsed)}`);

      // depositing some ERC20 transactions to fill the block
      await depositNTransactions(
        nf3Users[0],
        txPerBlock - 1,
        erc20Address,
        tokenType,
        transferValue,
        tokenId,
        fee,
      );
      eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
      const balanceAfter = (await nf3Users[0].getLayer2Balances())[erc721Address].length;
      expect(balanceAfter).to.be.lessThan(beforeBalance);
    });

    // it('should withdraw from L2, checking for L1 balance (only with time-jump client)', async function () {
    //   // now we need to sign the transaction and send it to the blockchain
    //   // this will only work if we're using Ganache, otherwiise expect failure
    //   // startBalance = await getBalance(nf3User1.ethereumAddress);
    //   if (nodeInfo.includes('TestRPC')) {
    //     let res = await nf3User1.finaliseWithdrawal(withdrawTransactions[1]);
    //     stateBalance += fee;
    //     expectTransaction(res);
    //     for (let i = 0; i < txPerBlock; i++) {
    //       // eslint-disable-next-line no-await-in-loop
    //       res = await nf3User1.transfer(
    //         false,
    //         erc20Address,
    //         tokenType,
    //         value,
    //         tokenId,
    //         nf3User1.zkpKeys.compressedPkd,
    //         fee,
    //       );
    //     }
    //     stateBalance += 2 * fee + BLOCK_STAKE;
    //     eventLogs = await waitForEvent(eventLogs, ['blockProposed']);
    //   } else {
    //     // geth
    //     console.log('     Not using a time-jump capable test client so this test is skipped');
    //     this.skip();
    //   }
    //   // endBalance = await getBalance(nf3User1.ethereumAddress);
    // });
  });

  after(async () => {
    await nf3Proposer1.deregisterProposer();
    await nf3Proposer1.close();
    await nf3Users[0].close();
    await nf3Users[1].close();
    await web3Client.closeWeb3();
  });
});
