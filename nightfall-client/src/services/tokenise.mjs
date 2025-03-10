import config from 'config';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import {
  getCircuitHash,
  generateProof,
} from '@polygon-nightfall/common-files/utils/worker-calls.mjs';
import { randValueLT } from '@polygon-nightfall/common-files/utils/crypto/crypto-random.mjs';
import gen from 'general-number';
import { ZkpKeys } from './keys.mjs';
import { Commitment, Transaction } from '../classes/index.mjs';
import { computeCircuitInputs } from '../utils/computeCircuitInputs.mjs';
import { clearPending } from './commitment-storage.mjs';
import { getCommitmentInfo } from '../utils/getCommitmentInfo.mjs';
import { submitTransaction } from '../utils/submitTransaction.mjs';

const { VK_IDS } = config;
const { SHIELD_CONTRACT_NAME, BN128_GROUP_ORDER } = constants;
const { generalise } = gen;

async function tokenise(items) {
  logger.info('Creating a tokenise transaction');
  const {
    salt = (await randValueLT(BN128_GROUP_ORDER)).hex(),
    value = 0,
    compressedZkpPublicKey,
    rootKey,
    tokenId = 0,
    fee,
  } = generalise(items);
  const ercAddress = generalise(items.ercAddress.toLowerCase());
  const zkpPublicKey = ZkpKeys.decompressZkpPublicKey(compressedZkpPublicKey);
  const commitment = new Commitment({ ercAddress, tokenId, value, zkpPublicKey, salt });

  const circuitHash = await getCircuitHash('tokenise');

  logger.debug({
    msg: 'Hash of new commitment',
    hash: commitment.hash.hex(),
  });

  // now we can compute a Witness so that we can generate the proof
  const shieldContractInstance = await waitForContract(SHIELD_CONTRACT_NAME);

  const maticAddress = generalise(
    (await shieldContractInstance.methods.getMaticAddress().call()).toLowerCase(),
  );

  // Currently just the fee commitments
  const commitmentsInfo = await getCommitmentInfo({
    totalValueToSend: 0n,
    fee,
    ercAddress,
    maticAddress,
    rootKey,
    maxNullifiers: VK_IDS.tokenise.numberNullifiers,
    maxNonFeeNullifiers: 0,
  });

  // Prepend the new tokenised commitment
  commitmentsInfo.newCommitments = [commitment, ...commitmentsInfo.newCommitments];

  try {
    const publicData = new Transaction({
      fee,
      historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
      circuitHash,
      commitments: commitmentsInfo.newCommitments,
      nullifiers: commitmentsInfo.nullifiers,
      numberNullifiers: VK_IDS.tokenise.numberNullifiers,
      numberCommitments: VK_IDS.tokenise.numberCommitments,
      isOnlyL2: true,
    });

    const privateData = {
      rootKey,
      oldCommitmentPreimage: commitmentsInfo.oldCommitments.map(o => {
        return { value: o.preimage.value, salt: o.preimage.salt };
      }),

      paths: commitmentsInfo.localSiblingPaths.map(siblingPath => siblingPath.slice(1)),
      orders: commitmentsInfo.leafIndices,
      newCommitmentPreimage: commitmentsInfo.newCommitments.map(o => {
        return { value: o.preimage.value, salt: o.preimage.salt };
      }),

      recipientPublicKeys: commitmentsInfo.newCommitments.map(o => o.preimage.zkpPublicKey),
      ercAddress,
      tokenId,
      value,
    };
    const witness = computeCircuitInputs(
      publicData,
      privateData,
      commitmentsInfo.roots,
      maticAddress,
      VK_IDS.tokenise.numberNullifiers,
      VK_IDS.tokenise.numberCommitments,
    );

    logger.debug({
      msg: 'witness input is',
      witness: JSON.stringify(witness, 0, 2),
    });

    const res = await generateProof({ folderpath: 'tokenise', witness });

    logger.trace({
      msg: 'Received response from generate-proof',
      response: JSON.stringify(res.data, null, 2),
    });

    const { proof } = res.data;

    const optimisticTokeniseTransaction = new Transaction({
      fee,
      historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
      circuitHash,
      commitments: commitmentsInfo.newCommitments,
      nullifiers: commitmentsInfo.nullifiers,
      proof,
      numberNullifiers: VK_IDS.tokenise.numberNullifiers,
      numberCommitments: VK_IDS.tokenise.numberCommitments,
      isOnlyL2: true,
    });

    logger.debug({
      msg: 'Client made transaction',
      transaction: JSON.stringify(optimisticTokeniseTransaction, null, 2),
    });

    return submitTransaction(
      optimisticTokeniseTransaction,
      commitmentsInfo,
      rootKey,
      shieldContractInstance,
      true,
    );
  } catch (error) {
    await Promise.all(commitmentsInfo.oldCommitments.map(o => clearPending(o)));
    throw new Error(error);
  }
}

export default tokenise;
