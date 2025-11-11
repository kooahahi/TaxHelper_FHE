pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TaxHelper_FHE is ZamaEthereumConfig {
    struct AssetRecord {
        string recordId;
        euint32 encryptedAmount;
        uint32 taxRate;
        uint256 timestamp;
        address owner;
        bool isVerified;
        uint32 decryptedAmount;
        uint32 calculatedTax;
    }

    mapping(string => AssetRecord) public assetRecords;
    string[] public recordIds;

    event AssetRecordCreated(string indexed recordId, address indexed owner);
    event TaxCalculated(string indexed recordId, uint32 taxAmount);
    event DecryptionVerified(string indexed recordId, uint32 decryptedAmount);

    constructor() ZamaEthereumConfig() {
    }

    function createAssetRecord(
        string calldata recordId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof,
        uint32 taxRate
    ) external {
        require(bytes(assetRecords[recordId].recordId).length == 0, "Record already exists");
        require(taxRate <= 10000, "Tax rate must be <= 100%");

        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, inputProof)), "Invalid encrypted input");

        assetRecords[recordId] = AssetRecord({
            recordId: recordId,
            encryptedAmount: FHE.fromExternal(encryptedAmount, inputProof),
            taxRate: taxRate,
            timestamp: block.timestamp,
            owner: msg.sender,
            isVerified: false,
            decryptedAmount: 0,
            calculatedTax: 0
        });

        FHE.allowThis(assetRecords[recordId].encryptedAmount);
        FHE.makePubliclyDecryptable(assetRecords[recordId].encryptedAmount);

        recordIds.push(recordId);

        emit AssetRecordCreated(recordId, msg.sender);
    }

    function calculateTax(string calldata recordId) external {
        require(bytes(assetRecords[recordId].recordId).length > 0, "Record does not exist");
        require(!assetRecords[recordId].isVerified, "Record already verified");

        euint32 memory encryptedTax = FHE.mul(
            assetRecords[recordId].encryptedAmount,
            assetRecords[recordId].taxRate
        );

        encryptedTax = FHE.div(encryptedTax, 10000);

        assetRecords[recordId].calculatedTax = FHE.decrypt(encryptedTax);
        assetRecords[recordId].isVerified = true;

        emit TaxCalculated(recordId, assetRecords[recordId].calculatedTax);
    }

    function verifyDecryption(
        string calldata recordId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(assetRecords[recordId].recordId).length > 0, "Record does not exist");
        require(!assetRecords[recordId].isVerified, "Record already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(assetRecords[recordId].encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        assetRecords[recordId].decryptedAmount = decodedValue;
        assetRecords[recordId].isVerified = true;

        emit DecryptionVerified(recordId, decodedValue);
    }

    function getAssetRecord(string calldata recordId) external view returns (
        string memory recordId_,
        uint32 taxRate,
        uint256 timestamp,
        address owner,
        bool isVerified,
        uint32 decryptedAmount,
        uint32 calculatedTax
    ) {
        require(bytes(assetRecords[recordId].recordId).length > 0, "Record does not exist");
        AssetRecord storage record = assetRecords[recordId];

        return (
            record.recordId,
            record.taxRate,
            record.timestamp,
            record.owner,
            record.isVerified,
            record.decryptedAmount,
            record.calculatedTax
        );
    }

    function getAllRecordIds() external view returns (string[] memory) {
        return recordIds;
    }

    function getEncryptedAmount(string calldata recordId) external view returns (euint32) {
        require(bytes(assetRecords[recordId].recordId).length > 0, "Record does not exist");
        return assetRecords[recordId].encryptedAmount;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

