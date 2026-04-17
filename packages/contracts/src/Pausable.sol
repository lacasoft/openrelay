// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

abstract contract Pausable {
    bool private _paused;
    address public guardian;

    event Paused(address account);
    event Unpaused(address account);
    event GuardianTransferred(address indexed previous, address indexed next);

    error EnforcedPause();
    error ExpectedPause();
    error NotGuardian();

    modifier whenNotPaused() {
        if (_paused) revert EnforcedPause();
        _;
    }

    modifier whenPaused() {
        if (!_paused) revert ExpectedPause();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address _guardian) {
        guardian = _guardian;
    }

    function pause() external onlyGuardian whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGuardian whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function transferGuardian(address newGuardian) external onlyGuardian {
        emit GuardianTransferred(guardian, newGuardian);
        guardian = newGuardian;
    }

    function paused() public view returns (bool) {
        return _paused;
    }
}
