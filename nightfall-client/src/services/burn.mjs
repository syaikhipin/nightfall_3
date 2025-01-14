import config from 'config';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import {
  getCircuitHash,
  generateProof,
} from '@polygon-nightfall/common-files/utils/worker-calls.mjs';
import gen from 'general-number';
import Transaction from '@polygon-nightfall/common-files/classes/transaction.mjs';
import { clearPending } from './commitment-storage.mjs';
import { getCommitmentInfo } from '../utils/getCommitmentInfo.mjs';
import { computeCircuitInputs } from '../utils/computeCircuitInputs.mjs';
import { submitTransaction } from '../utils/submitTransaction.mjs';

const { VK_IDS } = config;
const { SHIELD_CONTRACT_NAME } = constants;
const { generalise } = gen;

async function burn(burnParams) {
  logger.info('Creating a burn transaction');
  // let's extract the input items
  const { providedCommitments, ...items } = burnParams;
  const { rootKey, value, fee, tokenId } = generalise(items);
  const ercAddress = generalise(items.ercAddress.toLowerCase());
  const circuitHash = await getCircuitHash('burn');

  // now we can compute a Witness so that we can generate the proof
  const shieldContractInstance = await waitForContract(SHIELD_CONTRACT_NAME);

  const maticAddress = generalise(
    (await shieldContractInstance.methods.getMaticAddress().call()).toLowerCase(),
  );

  const commitmentsInfo = await getCommitmentInfo({
    totalValueToSend: generalise(value).bigInt,
    fee,
    ercAddress,
    tokenId,
    maticAddress,
    rootKey,
    maxNullifiers: VK_IDS.burn.numberNullifiers,
    maxNonFeeNullifiers: 1,
    providedCommitments,
  });

  // Burn will have two commitments. The first will belong to the change if commitment isn't fully burnt, and the second one to the fee.
  // Therefore, we need to make sure that if the commitment was completely burn we still keep this order.
  const newCommitmentsCircuit = [...commitmentsInfo.newCommitments];
  if (!commitmentsInfo.hasChange && commitmentsInfo.hasChangeFee) {
    newCommitmentsCircuit.unshift({
      hash: 0,
      preimage: { value: 0, salt: 0, zkpPublicKey: [0, 0] },
    });
  }

  try {
    const publicData = new Transaction({
      fee,
      historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
      circuitHash,
      commitments: newCommitmentsCircuit,
      nullifiers: commitmentsInfo.nullifiers,
      numberNullifiers: VK_IDS.burn.numberNullifiers,
      numberCommitments: VK_IDS.burn.numberCommitments,
      isOnlyL2: true,
    });

    const privateData = {
      rootKey,
      oldCommitmentPreimage: commitmentsInfo.oldCommitments.map(o => {
        return { value: o.preimage.value, salt: o.preimage.salt };
      }),

      paths: commitmentsInfo.localSiblingPaths.map(siblingPath => siblingPath.slice(1)),
      orders: commitmentsInfo.leafIndices,
      newCommitmentPreimage: newCommitmentsCircuit.map(o => {
        return { value: o.preimage.value, salt: o.preimage.salt };
      }),
      recipientPublicKeys: newCommitmentsCircuit.map(o => o.preimage.zkpPublicKey),
      ercAddress,
      tokenId,
      value,
    };

    const witness = computeCircuitInputs(
      publicData,
      privateData,
      commitmentsInfo.roots,
      maticAddress,
      VK_IDS.burn.numberNullifiers,
      VK_IDS.burn.numberCommitments,
    );

    logger.debug({
      msg: 'witness input is',
      witness: JSON.stringify(witness, 0, 2),
    });

    const res = await generateProof({ folderpath: 'burn', witness });

    logger.trace({
      msg: 'Received response from generate-proof',
      response: JSON.stringify(res.data, null, 2),
    });

    const { proof } = res.data;

    const optimisticBurnTransaction = new Transaction({
      fee,
      historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
      circuitHash,
      commitments: newCommitmentsCircuit,
      nullifiers: commitmentsInfo.nullifiers,
      proof,
      numberNullifiers: VK_IDS.burn.numberNullifiers,
      numberCommitments: VK_IDS.burn.numberCommitments,
      isOnlyL2: true,
    });

    logger.debug({
      msg: 'Client made transaction',
      transaction: JSON.stringify(optimisticBurnTransaction, null, 2),
    });

    return submitTransaction(
      optimisticBurnTransaction,
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

export default burn;
