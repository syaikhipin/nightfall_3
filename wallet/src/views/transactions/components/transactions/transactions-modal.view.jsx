import React from 'react';
import { Button, Modal, Form, Icon, Checkbox, Dropdown, Input } from 'semantic-ui-react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import * as txThunks from '../../../../store/transactions/transactions.thunks';
import * as txActionTypes from '../../../../store/transactions/transactions.actions';

import {
  DEFAULT_DEPOSIT_FEE,
  DEFAULT_INSTANT_WITHDRAW_FEE,
  TOKEN_TYPE,
  TX_TYPES,
} from '../../../../constants';

function TransactionsModal({ token, login, transactions, onSubmitTx, onCancelTx }) {
  const [fee, setFee] = React.useState(DEFAULT_DEPOSIT_FEE);
  const [tokenAmount, setTokenAmount] = React.useState(0);
  const [instantWithdrawFee, setInstantWithdrawFee] = React.useState(DEFAULT_INSTANT_WITHDRAW_FEE);
  const [instantWithdrawEnable, setInstantWithdrawEnable] = React.useState(false);
  const [directTransactionEnable, setDirectTransactionEnable] = React.useState(false);
  const [pkdX, setPkdX] = React.useState({
    value: '',
    error: null,
  });
  const [pkdY, setPkdY] = React.useState({
    value: '',
    error: null,
  });

  const toggleAll = () => {
    setInstantWithdrawEnable(false);
    setDirectTransactionEnable(false);
    setPkdX({ value: '', error: null });
    setPkdY({ value: '', error: null });
    onCancelTx();
  };

  function getTokenInfo() {
    const { tokenPool } = token;
    if (tokenPool === '') {
      return null;
    }
    return tokenPool.filter(tokenEl => tokenEl.id === token.activeTokenRowId)[0];
  }

  function validateContractAddress(key, value) {
    const error = {
      content: `Please enter a valid ${key}`,
      pointing: 'above',
    };
    if (key === 'PK-Y') {
      if (!/^0x([A-Fa-f0-9]{63,64})$/.test(value)) return setPkdY({ value: '', error });
      setPkdY({ value, error: null });
    }
    if (transactions.txType === 'withdraw') {
      if (!/^0x([A-Fa-f0-9]{40})$/.test(value)) return setPkdX({ value: '', error });
    } else if (!/^0x([A-Fa-f0-9]{63,64})$/.test(value)) return setPkdX({ value: '', error });
    return setPkdX({ value, error: null });
  }

  const handleOnSubmit = () => {
    const tokenInfo = getTokenInfo();
    if (!tokenInfo) {
      return;
    }
    switch (transactions.txType) {
      // TODO : pending select correct tokenId index. For now, i select 0, but it could be different
      case TX_TYPES.WITHDRAW:
        {
          const ethereumAddress = pkdX.value === '' ? login.nf3.ethereumAddress : pkdX.value;
          const withdrawType = instantWithdrawEnable
            ? TX_TYPES.INSTANT_WITHDRAW
            : TX_TYPES.WITHDRAW;
          onSubmitTx({
            txType: withdrawType,
            ethereumAddress,
            tokenType: tokenInfo.tokenType,
            tokenAddress: tokenInfo.tokenAddress,
            tokenId: tokenInfo.tokenId[0],
            tokenAmount: tokenInfo.tokenType === TOKEN_TYPE.ERC721 ? '1' : tokenAmount,
            fee,
            instantWithdrawFee,
          });
        }
        break;

      default: {
        const pkd =
          pkdX.value === '' || pkdY.value === '' ? login.nf3.zkpKeys.pkd : [pkdX.value, pkdY.value];
        const { txType } = transactions;
        onSubmitTx({
          txType,
          pkd,
          tokenType: tokenInfo.tokenType,
          tokenAddress: tokenInfo.tokenAddress,
          tokenId: tokenInfo.tokenId[0],
          tokenAmount: tokenInfo.tokenType === TOKEN_TYPE.ERC721 ? '1' : tokenAmount,

          fee,
        });
      }
    }

    setInstantWithdrawEnable(false);
    setDirectTransactionEnable(false);
  };

  const tokenInfo = getTokenInfo();
  if (!tokenInfo) {
    return null;
  }
  const keyLabel = transactions.txType === TX_TYPES.WITHDRAW ? 'Ethereum Address' : 'PK-X';
  const pkd = login.isWalletInitialized ? login.nf3.zkpKeys.pkd : '';

  if (transactions.txType === '') return null;
  return (
    <Modal open={transactions.modalTx}>
      <Modal.Header>{transactions.txType.toUpperCase()}</Modal.Header>
      <Modal.Content>
        <Form>
          <Form.Group widths="equal">
            {transactions.txType === TX_TYPES.WITHDRAW ? (
              <Form.Field>
                <Checkbox
                  label="Instant Withdraw"
                  onChange={() => setInstantWithdrawEnable(!instantWithdrawEnable)}
                  checked={instantWithdrawEnable}
                />
              </Form.Field>
            ) : null}
            {instantWithdrawEnable ? (
              <Form.Field>
                <label htmlFor="instante-withdrawfee">
                  Instant Withdraw Fee
                  <input
                    type="text"
                    placeholder={instantWithdrawFee}
                    onChange={event => setInstantWithdrawFee(event.target.value)}
                  />
                </label>
              </Form.Field>
            ) : null}
          </Form.Group>
          {transactions.txType !== TX_TYPES.DEPOSIT ? (
            <Form.Field>
              <Checkbox
                label="Direct Transaction"
                onChange={() => setDirectTransactionEnable(!directTransactionEnable)}
                checked={directTransactionEnable}
              />
            </Form.Field>
          ) : null}
          <Form.Group widths="equal">
            <Form.Field
              control={Input}
              label={keyLabel}
              placeholder={
                transactions.txType === TX_TYPES.WITHDRAW ? login.nf3.ethereumAddress : pkd[0]
              }
              onChange={event => validateContractAddress(keyLabel, event.target.value)}
              error={pkdX.error}
            />

            {transactions.txType !== TX_TYPES.WITHDRAW ? (
              <Form.Field
                control={Input}
                label="PK-Y"
                placeholder={pkd[1]}
                onChange={event => validateContractAddress('PK-Y', event.target.value)}
                error={pkdY.error}
              />
            ) : null}
          </Form.Group>
          <Form.Group widths="equal">
            <Form.Field>
              <label> Token Type </label>
              <input type="text" value={tokenInfo.tokenType} id="token-type" readOnly />
            </Form.Field>
            <Form.Field>
              <label> Token </label>
              <input type="text" value={tokenInfo.tokenAddress} id="token-address" readOnly />
            </Form.Field>
          </Form.Group>
          {tokenInfo.tokenType !== TOKEN_TYPE.ERC20 ? (
            <Form.Group>
              <Form.Field width={6}>
                <span>
                  Token Id{' '}
                  <Dropdown
                    placeholder={tokenInfo.tokenId[0]}
                    defaultValue={tokenInfo.tokenId[0]}
                    selection
                    options={tokenInfo.tokenId.map(function (id) {
                      return { key: id, text: id, value: id };
                    })}
                    onChange={(e, { value }) => value}
                  />
                </span>
              </Form.Field>
            </Form.Group>
          ) : null}
          <Form.Group widths="equal">
            {tokenInfo.tokenType === TOKEN_TYPE.ERC721 ? null : (
              <Form.Field>
                <label htmlFor="amount">
                  Amount
                  <input
                    type="number"
                    min="0"
                    id="amount"
                    onChange={event => setTokenAmount(event.target.value)}
                  />
                </label>
              </Form.Field>
            )}
            <Form.Field>
              <label htmlFor="fee">
                Fee
                <input
                  type="number"
                  min="0"
                  placeholder={fee}
                  onChange={event => setFee(event.target.value)}
                  id="fee"
                />
              </label>
            </Form.Field>
          </Form.Group>
        </Form>
      </Modal.Content>
      <Modal.Actions>
        <div>
          <Button
            floated="left"
            disabled={transactions.txType === ''}
            color="red"
            onClick={toggleAll}
          >
            <Icon name="cancel" />
            Cancel
          </Button>
          <Button
            floated="right"
            disabled={transactions.txType === ''}
            color="blue"
            onClick={handleOnSubmit}
          >
            <Icon name="send" />
            Submit
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}

TransactionsModal.propTypes = {
  token: PropTypes.object.isRequired,
  login: PropTypes.object.isRequired,
  transactions: PropTypes.object.isRequired,
  onSubmitTx: PropTypes.func.isRequired,
  onCancelTx: PropTypes.func.isRequired,
};

const mapStateToProps = state => ({
  token: state.token,
  login: state.login,
  transactions: state.transactions,
});

const mapDispatchToProps = dispatch => ({
  onSubmitTx: txParams => dispatch(txThunks.txSubmit(txParams)),
  onCancelTx: () => dispatch(txActionTypes.txCancel()),
});

export default connect(mapStateToProps, mapDispatchToProps)(TransactionsModal);