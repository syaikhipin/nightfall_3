import React from 'react';
import {
  Button,
  Modal,
  Form,
  Icon,
  TextArea,
  Grid,
  Message,
  Divider,
  Checkbox,
} from 'semantic-ui-react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { generateMnemonic } from 'bip39';
import { mnemonicBackupEnable } from '../../../store/settings/settings.actions';

function CreateWalletModal({
  modalEnable,
  handleClickOnImport,
  toggleModalEnable,
  onMnemonicBackupEnable,
}) {
  const [mnemonic, setMnemonic] = React.useState('');
  const [mnemonicBackup, setMnemonicBackup] = React.useState(false);

  const handleSubmit = () => {
    setMnemonic('');
    onMnemonicBackupEnable(mnemonicBackup);
    handleClickOnImport(mnemonic, false);
  };

  const newMnemonic = () => {
    setMnemonic(generateMnemonic());
  };

  const toggleMnemonicBackupEnable = () => {
    setMnemonicBackup(!mnemonicBackup);
  };

  return (
    <Modal open={modalEnable}>
      <Modal.Header>Enter Nightfall Mnemonic</Modal.Header>
      <Modal.Content>
        <Form warning>
          <Form.Field>
            <Message warning>
              <Message.Header>
                These 12 words can restore all of your Nightfall accounts. Save them somewhere safe
                and secret even if you select to make a backup. The backup option is only offered to
                easily login into your nightfall account, but not as a permanent backup.
              </Message.Header>
            </Message>
          </Form.Field>
          <label htmlFor="mnemonic">Mnemonic</label>
          <Grid>
            <Grid.Column width={12}>
              <Form.Field>
                <TextArea value={mnemonic} style={{ minheight: 100 }} />
              </Form.Field>
            </Grid.Column>
            <Grid.Column width={4}>
              <Form.Field>
                <Button color="green" onClick={newMnemonic}>
                  <Icon name="question" />
                  New
                </Button>
              </Form.Field>
              <Form.Field>
                <Checkbox
                  toggle
                  label="Backup Mnemonic"
                  checked={mnemonicBackup}
                  onChange={toggleMnemonicBackupEnable}
                />
              </Form.Field>
            </Grid.Column>
          </Grid>
          <Divider />
          <Form.Field></Form.Field>
          <Modal.Actions>
            <Button floated="left" color="red" onClick={toggleModalEnable}>
              <Icon name="cancel" />
              Cancel
            </Button>
            <Button floated="right" color="blue" disabled={mnemonic === ''} onClick={handleSubmit}>
              <Icon name="send" />
              Submit
            </Button>
          </Modal.Actions>
        </Form>
      </Modal.Content>
    </Modal>
  );
}

CreateWalletModal.propTypes = {
  modalEnable: PropTypes.bool.isRequired,
  handleClickOnImport: PropTypes.func.isRequired,
  toggleModalEnable: PropTypes.func.isRequired,
  onMnemonicBackupEnable: PropTypes.func.isRequired,
};

const mapStateToProps = () => ({});

const mapDispatchToProps = dispatch => ({
  onMnemonicBackupEnable: backupEnable => dispatch(mnemonicBackupEnable(backupEnable)),
});

export default connect(mapStateToProps, mapDispatchToProps)(CreateWalletModal);