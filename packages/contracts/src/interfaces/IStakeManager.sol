// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

interface IStakeManager {
    function depositFor(address operator, uint256 amount) external;
    function slash(address operator, uint256 amount, bytes32 disputeId) external;
}
