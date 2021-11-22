import React from 'react';
import { Menu, Icon, Button } from 'semantic-ui-react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { deleteWallet } from '../../../../store/login/login.actions';
import AccountSettingsModal from './account-settings.view.jsx';

function HeaderMenu({ onDeleteWallet }) {
  const [accountSettingsEnable, setAccountSettingsEnable] = React.useState(false);

  const toggleAccountSettings = () => {
    setAccountSettingsEnable(!accountSettingsEnable);
  };

  const handleClickNFInfo = () => {};
  return (
    <Menu secondary>
      <Menu.Menu position="right">
        <Button name="logout" onClick={onDeleteWallet}>
          <Icon name="upload" size="large" />
          Logout
        </Button>
        <Button name="account-settings" onClick={() => toggleAccountSettings()}>
          <Icon name="settings" size="large" />
          Account Settings
        </Button>
        <Button name="account-info" disabled onClick={() => handleClickNFInfo()}>
          <Icon name="question" size="large" />
          NightFall Information
        </Button>
      </Menu.Menu>
      <AccountSettingsModal
        accountSettingsEnable={accountSettingsEnable}
        toggleAccountSettings={toggleAccountSettings}
      />
    </Menu>
  );
}

HeaderMenu.propTypes = {
  onDeleteWallet: PropTypes.func.isRequired,
};

const mapStateToProps = () => ({});

const mapDispatchToProps = dispatch => ({
  onDeleteWallet: () => dispatch(deleteWallet()),
});

export default connect(mapStateToProps, mapDispatchToProps)(HeaderMenu);