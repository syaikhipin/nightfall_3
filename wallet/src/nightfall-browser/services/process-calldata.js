// ignore unused exports default

/**
Function to retreive calldata associated with a blockchain event.
This is used, rather than re-emmiting the calldata in the event because it's
much cheaper, although the offchain part is more complex.
*/
import Web3 from '../../common-files/utils/web3';
import { unpackBlockInfo } from '../../common-files/utils/block-utils.js';
import Transaction from '../../common-files/classes/transaction';
import { decompressProof } from '../../common-files/utils/curve-maths/curves';

const { SIGNATURES } = global.config;

async function getProposeBlockCalldata(eventData) {
  const web3 = Web3.connection();
  const { transactionHash } = eventData;
  const tx = await web3.eth.getTransaction(transactionHash);
  // Remove the '0x' and function signature to recove rhte abi bytecode
  const abiBytecode = `0x${tx.input.slice(10)}`;
  const decoded = web3.eth.abi.decodeParameters(SIGNATURES.PROPOSE_BLOCK, abiBytecode);
  const blockData = decoded['0'];
  const transactionsData = decoded['1'];
  const [packedBlockInfo, root, previousBlockHash, frontierHash, transactionHashesRoot] = blockData;

  const { leafCount, proposer, blockNumberL2 } = unpackBlockInfo(packedBlockInfo);

  const block = {
    proposer,
    root,
    leafCount: Number(leafCount),
    blockNumberL2: Number(blockNumberL2),
    previousBlockHash,
    frontierHash,
    transactionHashesRoot,
  };
  const transactions = transactionsData.map(t => {
    const [
      packedInfo,
      historicRootBlockNumberL2Packed,
      tokenId,
      ercAddress,
      recipientAddress,
      commitments,
      nullifiers,
      compressedSecrets,
      proof,
    ] = t;

    const { value, fee, circuitHash, tokenType } = Transaction.unpackTransactionInfo(packedInfo);

    const historicRootBlockNumberL2 = Transaction.unpackHistoricRoot(
      nullifiers.length,
      historicRootBlockNumberL2Packed,
    );

    const transaction = {
      value,
      fee,
      circuitHash,
      tokenType,
      historicRootBlockNumberL2,
      tokenId,
      ercAddress,
      recipientAddress,
      commitments,
      nullifiers,
      compressedSecrets,
      proof: decompressProof(proof),
    };
    // note, this transaction is incomplete in that the 'fee' field is empty.
    // that shouldn't matter as it's not needed.
    transaction.transactionHash = Transaction.calcHash(transaction);
    return transaction;
  });

  block.transactionHashes = transactions.map(t => t.transactionHash);
  return { transactions, block };
}

export default getProposeBlockCalldata;
