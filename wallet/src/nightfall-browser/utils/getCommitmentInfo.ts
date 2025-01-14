import gen, { GeneralNumber } from 'general-number';
import { randValueLT } from '../../common-files/utils/crypto/crypto-random';
import Commitment from '../classes/commitment';
import Nullifier from '../classes/nullifier';
import {
  clearPending,
  findUsableCommitmentsMutex,
  getCommitmentsByHash,
  getSiblingInfo,
  markPending,
} from '../services/commitment-storage';
import { ZkpKeys } from '../services/keys';

const { generalise } = gen;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const { BN128_GROUP_ORDER } = global.nightfallConstants;

type CommitmentsInfo = {
  oldCommitments: any[];
  newCommitments: any[];
  leafIndices: any[];
  localSiblingPaths: any[];
  blockNumberL2s: any[];
  roots: any[];
  nullifiers: any[];
  salts: any[];
};

type TxInfo = {
  totalValueToSend: bigint;
  fee: bigint;
  recipientZkpPublicKeysArray: any[];
  ercAddress: GeneralNumber;
  maticAddress: GeneralNumber;
  tokenId: GeneralNumber;
  rootKey: any;
  maxNullifiers: number;
  maxNonFeeNullifiers: number | undefined;
  providedCommitments: string[];
};

const getCommitmentInfo = async (txInfo: TxInfo): Promise<CommitmentsInfo> => {
  const {
    totalValueToSend,
    fee = 0n,
    recipientZkpPublicKeysArray = [],
    ercAddress,
    maticAddress,
    tokenId = generalise(0),
    rootKey,
    providedCommitments = [],
  } = txInfo;

  let { maxNullifiers, maxNonFeeNullifiers = undefined } = txInfo;

  const { zkpPublicKey, compressedZkpPublicKey, nullifierKey } = new ZkpKeys(rootKey);

  const valuesArray = recipientZkpPublicKeysArray.map(() => totalValueToSend);

  const ercAddressArray = recipientZkpPublicKeysArray.map(() => ercAddress);

  const tokenIdArray = recipientZkpPublicKeysArray.map(() => tokenId);
  const addedFee = maticAddress.hex(32) === ercAddress.hex(32) ? fee : 0n;

  let value = totalValueToSend + addedFee;
  const feeValue = fee - addedFee;

  if (maxNonFeeNullifiers === undefined) {
    maxNonFeeNullifiers = feeValue > 0n ? maxNullifiers - 1 : maxNullifiers;
  }

  const spentCommitments = [];
  try {
    let validatedProvidedCommitments = [];
    if (providedCommitments.length > 0) {
      const commitmentHashes = providedCommitments.map(c => c.toString());
      const rawCommitments = await getCommitmentsByHash(
        commitmentHashes,
        compressedZkpPublicKey,
        ercAddress,
        tokenId,
      );

      if (rawCommitments.length < commitmentHashes.length) {
        const invalidHashes = commitmentHashes.filter(ch => {
          for (const rc of rawCommitments) {
            if (rc._id === ch) return false;
          }
          return true;
        });
        throw new Error(`invalid commitment hashes: ${invalidHashes}`);
      }

      const providedValue = rawCommitments
        .map((c: any) => generalise(c.preimage.value).bigInt)
        .reduce((sum: bigint, c: bigint) => sum + c);

      if (providedValue < totalValueToSend)
        throw new Error('provided commitments do not cover the value');

      // transform the hashes retrieved from the DB to well formed commitments
      validatedProvidedCommitments = rawCommitments.map((ct: any) => new Commitment(ct.preimage));

      if (maticAddress.hex(32) === ercAddress.hex(32)) {
        // the user provided enough commitments to cover the value but not the fee
        // this can only happen when the token to send is the fee token
        // we need to set the value here instead of the feeValue
        value = providedValue >= value ? 0n : value - providedValue;
      } else {
        maxNonFeeNullifiers = 0;
      }

      maxNullifiers -= validatedProvidedCommitments.length;
      await Promise.all(validatedProvidedCommitments.map((c: Commitment) => markPending(c)));
      spentCommitments.push(...validatedProvidedCommitments);
    }

    const commitments = await findUsableCommitmentsMutex(
      compressedZkpPublicKey,
      ercAddress,
      tokenId,
      maticAddress,
      value,
      feeValue,
      maxNullifiers,
      maxNonFeeNullifiers,
    );

    const { oldCommitments, oldCommitmentsFee } = commitments;
    spentCommitments.push(...oldCommitments);
    spentCommitments.push(...oldCommitmentsFee);

    oldCommitments.push(...validatedProvidedCommitments);

    // Compute the nullifiers
    const nullifiers = spentCommitments.map(commitment => new Nullifier(commitment, nullifierKey));

    // then the new output commitment(s)
    const totalInputCommitmentValue = oldCommitments.reduce(
      (acc: bigint, commitment: Commitment) => acc + commitment.preimage.value.bigInt,
      0n,
    );

    // we may need to return change to the recipient
    const change = totalInputCommitmentValue - value;

    // if so, add an output commitment to do that
    if (generalise(change).bigInt !== 0n) {
      valuesArray.push(generalise(change).bigInt);
      recipientZkpPublicKeysArray.push(zkpPublicKey);
      ercAddressArray.push(ercAddress);
      tokenIdArray.push(tokenId);
    }

    // then the new output commitment(s) fee
    const totalInputCommitmentFeeValue = oldCommitmentsFee.reduce(
      (acc: bigint, commitment: Commitment) => acc + commitment.preimage.value.bigInt,
      0n,
    );

    // we may need to return change to the recipient
    const changeFee = totalInputCommitmentFeeValue - feeValue;

    // if so, add an output commitment to do that
    if (generalise(changeFee).bigInt !== 0n) {
      valuesArray.push(generalise(changeFee).bigInt);
      recipientZkpPublicKeysArray.push(zkpPublicKey);
      ercAddressArray.push(maticAddress);
      tokenIdArray.push(generalise(0));
    }

    const salts = await Promise.all(
      recipientZkpPublicKeysArray.map(async () => randValueLT(BN128_GROUP_ORDER)),
    );

    // Generate new commitments, already truncated to u32[7]
    const newCommitments = recipientZkpPublicKeysArray.map(
      (recipientKey, i) =>
        new Commitment({
          ercAddress: ercAddressArray[i],
          tokenId: tokenIdArray[i],
          value: valuesArray[i],
          zkpPublicKey: recipientKey,
          salt: salts[i],
        }),
    );

    // Commitment Tree Information
    const commitmentTreeInfo = await Promise.all(spentCommitments.map(c => getSiblingInfo(c)));
    const localSiblingPaths = commitmentTreeInfo.map(l => {
      const path = l.siblingPath.path.map((p: any) => p.value);
      return generalise([l.root].concat(path.reverse()));
    });
    const leafIndices = commitmentTreeInfo.map(l => l.leafIndex);
    const blockNumberL2s = commitmentTreeInfo.map(l => l.isOnChain);
    const roots = commitmentTreeInfo.map(l => l.root);

    return {
      oldCommitments: spentCommitments,
      nullifiers,
      newCommitments,
      localSiblingPaths,
      leafIndices,
      blockNumberL2s,
      roots,
      salts,
    };
  } catch (err) {
    console.log('ERR', err);
    await Promise.all(spentCommitments.map((o: any) => clearPending(o)));
    throw err;
  }
};

export default getCommitmentInfo;
